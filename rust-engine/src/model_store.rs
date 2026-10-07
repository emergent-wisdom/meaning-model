//! Every model revision a session holds, kept compactly: a revision whose predecessor is held is kept as its changes
//! from it, and only a revision without one is kept whole. A full model is rebuilt from those changes when it is asked
//! for and checked against its hash; the most recently used ones stay rebuilt. Memory and the stored history therefore
//! grow with what each revision changed, not with the size of the whole model times the number of revisions.

use super::model_delta::{self, ModelDelta};
use super::{compile_model, error, serialized_size, CompiledModel, EngineResult, ModelDefinition};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// How many rebuilt models stay ready. The head of a lineage is asked for on almost every call, so it stays.
const REBUILT_MODELS_KEPT: usize = 4;

/// A model revision as it is stored: whole, or as its changes from the revision it was made from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StoredModel {
    Changes { model_hash: String, base_model_hash: String, delta: ModelDelta },
    Whole { model_hash: String, definition: Box<ModelDefinition> },
}

impl StoredModel {
    pub fn model_hash(&self) -> &str {
        match self {
            StoredModel::Changes { model_hash, .. } | StoredModel::Whole { model_hash, .. } => model_hash,
        }
    }

    /// The revision this one is rebuilt after: its base, or for a whole revision the one it was made from.
    fn rebuilt_after(&self) -> Option<&str> {
        match self {
            StoredModel::Changes { base_model_hash, .. } => Some(base_model_hash),
            StoredModel::Whole { definition, .. } => definition.revision.previous_model_hash.as_deref(),
        }
    }
}

/// What is known about a revision without rebuilding it.
#[derive(Debug, Clone)]
pub struct ModelEntry {
    pub id: String,
    pub revision_number: u64,
    pub stored: StoredModel,
}

#[derive(Debug, Default)]
pub struct ModelStore {
    entries: BTreeMap<String, ModelEntry>,
    stored_bytes: usize,
    rebuilt: RefCell<Rebuilt>,
}

#[derive(Debug, Default)]
struct Rebuilt {
    models: BTreeMap<String, (Arc<CompiledModel>, u64)>,
    clock: u64,
}

impl ModelStore {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains_key(&self, model_hash: &str) -> bool {
        self.entries.contains_key(model_hash)
    }

    /// The bytes the stored revisions take: whole definitions and changes as they are written.
    pub fn stored_bytes(&self) -> usize {
        self.stored_bytes
    }

    pub fn entries(&self) -> impl Iterator<Item = (&String, &ModelEntry)> {
        self.entries.iter()
    }

    pub fn entry(&self, model_hash: &str) -> Option<&ModelEntry> {
        self.entries.get(model_hash)
    }

    /// The revision with this hash, rebuilt if it is not ready, or `None` when the session does not hold it.
    pub fn get(&self, model_hash: &str) -> EngineResult<Option<Arc<CompiledModel>>> {
        if !self.entries.contains_key(model_hash) {
            return Ok(None);
        }
        if let Some(model) = self.ready(model_hash) {
            return Ok(Some(model));
        }
        let model = Arc::new(self.rebuild(model_hash)?);
        self.keep(&model);
        Ok(Some(model))
    }

    /// How a new revision would be kept: as its changes from its previous revision when the session holds that one
    /// and the changes are smaller than the whole, otherwise whole.
    pub fn kept_form(&self, model: &CompiledModel) -> EngineResult<StoredModel> {
        match &model.revision.previous_model_hash {
            Some(previous) if self.entries.contains_key(previous) => {
                let base = self.get(previous)?.ok_or_else(|| error("the previous model revision is unavailable"))?;
                kept_form(model, Some((previous.as_str(), base.definition())))
            }
            _ => kept_form(model, None),
        }
    }

    /// Rebuilds a stored revision whose base, if it has one, the session already holds, and checks it against its hash.
    pub fn rebuild_stored(&self, stored: &StoredModel) -> EngineResult<CompiledModel> {
        let (model_hash, definition) = match stored {
            StoredModel::Whole { model_hash, definition } => (model_hash, (**definition).clone()),
            StoredModel::Changes { model_hash, base_model_hash, delta } => {
                let base = self
                    .get(base_model_hash)?
                    .ok_or_else(|| error(format!("stored model revision {model_hash} lacks its base {base_model_hash}")))?;
                let mut value = definition_value(base.definition())?;
                model_delta::apply(&mut value, delta)
                    .map_err(|cause| error(format!("stored model revision {model_hash} does not rebuild: {cause}")))?;
                let definition = serde_json::from_value(value)
                    .map_err(|cause| error(format!("stored model revision {model_hash} does not rebuild: {cause}")))?;
                (model_hash, definition)
            }
        };
        let model = compile_model(definition)?;
        if &model.model_hash != model_hash {
            return Err(error(format!("stored model revision {model_hash} does not match its content hash")));
        }
        Ok(model)
    }

    /// Adds a revision exactly as it was stored, after the caller has rebuilt it and checked its hash.
    pub fn insert_stored(&mut self, model: Arc<CompiledModel>, stored: StoredModel) -> EngineResult<()> {
        if stored.model_hash() != model.model_hash || self.entries.contains_key(&model.model_hash) {
            return Err(error("a stored model revision does not match its place in the session"));
        }
        if let StoredModel::Changes { base_model_hash, .. } = &stored {
            if !self.entries.contains_key(base_model_hash) {
                return Err(error("a stored model revision names a base the session does not hold"));
            }
        }
        self.add_entry(&model, stored)?;
        self.keep(&model);
        Ok(())
    }

    fn add_entry(&mut self, model: &CompiledModel, stored: StoredModel) -> EngineResult<()> {
        let stored_bytes = serialized_size(&stored)?;
        self.stored_bytes = self
            .stored_bytes
            .checked_add(stored_bytes)
            .ok_or_else(|| error("stored model byte count overflow"))?;
        self.entries.insert(
            model.model_hash.clone(),
            ModelEntry { id: model.id.clone(), revision_number: model.revision.number, stored },
        );
        Ok(())
    }

    fn ready(&self, model_hash: &str) -> Option<Arc<CompiledModel>> {
        let mut rebuilt = self.rebuilt.borrow_mut();
        rebuilt.clock += 1;
        let clock = rebuilt.clock;
        let (model, used) = rebuilt.models.get_mut(model_hash)?;
        *used = clock;
        Some(model.clone())
    }

    fn keep(&self, model: &Arc<CompiledModel>) {
        let mut rebuilt = self.rebuilt.borrow_mut();
        rebuilt.clock += 1;
        let clock = rebuilt.clock;
        rebuilt.models.insert(model.model_hash.clone(), (model.clone(), clock));
        while rebuilt.models.len() > REBUILT_MODELS_KEPT {
            let Some(oldest) = rebuilt.models.iter().min_by_key(|(_, (_, used))| *used).map(|(hash, _)| hash.clone()) else {
                break;
            };
            rebuilt.models.remove(&oldest);
        }
    }

    /// Rebuilds a revision from the nearest ancestor that is ready or kept whole, applying each revision's changes in
    /// turn to one working copy, and checks the result against its hash.
    fn rebuild(&self, model_hash: &str) -> EngineResult<CompiledModel> {
        let mut changes: Vec<&ModelDelta> = Vec::new();
        let mut cursor = model_hash;
        let mut value = loop {
            if changes.len() > self.entries.len() {
                return Err(error("stored model revisions form a cycle"));
            }
            if cursor != model_hash {
                if let Some(model) = self.ready(cursor) {
                    break definition_value(model.definition())?;
                }
            }
            let entry = self
                .entries
                .get(cursor)
                .ok_or_else(|| error(format!("stored model revision {model_hash} lacks its base {cursor}")))?;
            match &entry.stored {
                StoredModel::Whole { definition, .. } => break definition_value(definition)?,
                StoredModel::Changes { base_model_hash, delta, .. } => {
                    changes.push(delta);
                    cursor = base_model_hash;
                }
            }
        };
        for delta in changes.iter().rev() {
            model_delta::apply(&mut value, delta).map_err(|cause| error(format!("stored model revision {model_hash} does not rebuild: {cause}")))?;
        }
        let definition: ModelDefinition = serde_json::from_value(value)
            .map_err(|cause| error(format!("stored model revision {model_hash} does not rebuild: {cause}")))?;
        let model = compile_model(definition)?;
        if model.model_hash != model_hash {
            return Err(error(format!("stored model revision {model_hash} rebuilds with a different hash")));
        }
        Ok(model)
    }
}

/// How a revision is kept: as its changes from `base` when they rebuild it exactly and are smaller, otherwise whole.
pub fn kept_form(model: &CompiledModel, base: Option<(&str, &ModelDefinition)>) -> EngineResult<StoredModel> {
    let whole = StoredModel::Whole { model_hash: model.model_hash.clone(), definition: Box::new(model.definition().clone()) };
    let Some((base_model_hash, base)) = base else {
        return Ok(whole);
    };
    let Some(delta) = model_delta::compute(&definition_value(base)?, &definition_value(model.definition())?) else {
        return Ok(whole);
    };
    let changes = StoredModel::Changes { model_hash: model.model_hash.clone(), base_model_hash: base_model_hash.to_owned(), delta };
    Ok(if serialized_size(&changes)? < serialized_size(&whole)? { changes } else { whole })
}

fn definition_value(definition: &ModelDefinition) -> EngineResult<Value> {
    serde_json::to_value(definition).map_err(|cause| error(format!("failed to encode a model definition: {cause}")))
}

/// The order in which stored revisions can be rebuilt: every revision after the one it is rebuilt from.
pub fn rebuild_order(stored: &[StoredModel]) -> EngineResult<Vec<usize>> {
    let index: BTreeMap<&str, usize> = stored.iter().enumerate().map(|(i, row)| (row.model_hash(), i)).collect();
    if index.len() != stored.len() {
        return Err(error("state file contains a duplicate model hash"));
    }
    let mut children: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut roots = Vec::new();
    for (i, row) in stored.iter().enumerate() {
        match row.rebuilt_after().and_then(|hash| index.get(hash)) {
            Some(parent) => children.entry(*parent).or_default().push(i),
            None => {
                if let StoredModel::Changes { model_hash, .. } = row {
                    return Err(error(format!("stored model revision {model_hash} lacks its base")));
                }
                roots.push(i);
            }
        }
    }
    let mut order = Vec::with_capacity(stored.len());
    let mut stack: Vec<usize> = roots.into_iter().rev().collect();
    let mut seen = BTreeSet::new();
    while let Some(i) = stack.pop() {
        if !seen.insert(i) {
            continue;
        }
        order.push(i);
        if let Some(next) = children.get(&i) {
            stack.extend(next.iter().rev());
        }
    }
    if order.len() != stored.len() {
        return Err(error("stored model revisions form a cycle"));
    }
    Ok(order)
}
