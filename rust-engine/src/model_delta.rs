//! A model revision kept as its changes from the revision it was made from.
//!
//! A model definition is plain JSON. A delta lists each place where a revision differs from its base: a value set
//! there, a key removed, or, in a collection whose records each carry a unique string `id`, the records added or
//! changed (each whole) and the ids removed. Applying a delta to its base rebuilds the revision exactly. `compute`
//! proves that before it returns a delta, so a delta that would rebuild anything else is never produced.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const MODEL_DELTA_SCHEMA: &str = "life-sim-rust-model-delta/v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDelta {
    pub schema: String,
    pub changes: Vec<ModelChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum ModelChange {
    /// The value at `path` becomes `value`: a key added, or a value replaced whole.
    Set { path: Vec<String>, value: Value },
    /// The key at the end of `path` is removed.
    Unset { path: Vec<String> },
    /// In the collection at `path`, each record in `upsert` replaces the record with its id or is added, and the
    /// records with the ids in `remove` are removed. With `sorted` the collection is kept in ascending id order;
    /// otherwise kept records keep their places and added ones follow in the order given.
    Records {
        path: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        upsert: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        remove: Vec<String>,
        #[serde(default)]
        sorted: bool,
    },
}

/// The delta that rebuilds `target` from `base`, or `None` when no delta rebuilds it exactly.
pub fn compute(base: &Value, target: &Value) -> Option<ModelDelta> {
    let mut changes = Vec::new();
    diff(base, target, &mut Vec::new(), &mut changes);
    let delta = ModelDelta { schema: MODEL_DELTA_SCHEMA.to_owned(), changes };
    let mut rebuilt = base.clone();
    apply(&mut rebuilt, &delta).ok()?;
    (rebuilt == *target).then_some(delta)
}

/// Rebuilds a revision in place from its base. A delta that does not fit its base is an error, never a guess.
pub fn apply(value: &mut Value, delta: &ModelDelta) -> Result<(), String> {
    if delta.schema != MODEL_DELTA_SCHEMA {
        return Err(format!("unsupported model delta schema {}", delta.schema));
    }
    for change in &delta.changes {
        match change {
            ModelChange::Set { path, value: replacement } => match path.split_last() {
                None => *value = replacement.clone(),
                Some((key, parents)) => {
                    object_at(value, parents)?.insert(key.clone(), replacement.clone());
                }
            },
            ModelChange::Unset { path } => {
                let (key, parents) = path.split_last().ok_or("a model delta cannot remove the whole model")?;
                if object_at(value, parents)?.remove(key).is_none() {
                    return Err(format!("a model delta removes {} which its base does not have", path.join(".")));
                }
            }
            ModelChange::Records { path, upsert, remove, sorted } => {
                let records = match path.split_last() {
                    None => value.as_array_mut(),
                    Some((key, parents)) => object_at(value, parents)?.get_mut(key).and_then(Value::as_array_mut),
                }
                .ok_or_else(|| format!("a model delta changes records at {} where its base has none", path.join(".")))?;
                apply_records(records, upsert, remove, *sorted)?;
            }
        }
    }
    Ok(())
}

fn diff(base: &Value, target: &Value, path: &mut Vec<String>, out: &mut Vec<ModelChange>) {
    if base == target {
        return;
    }
    match (base, target) {
        (Value::Object(old), Value::Object(new)) => {
            for key in old.keys().filter(|key| !new.contains_key(*key)) {
                path.push(key.clone());
                out.push(ModelChange::Unset { path: path.clone() });
                path.pop();
            }
            for (key, value) in new {
                path.push(key.clone());
                match old.get(key) {
                    Some(previous) => diff(previous, value, path, out),
                    None => out.push(ModelChange::Set { path: path.clone(), value: value.clone() }),
                }
                path.pop();
            }
        }
        (Value::Array(old), Value::Array(new)) => match records_change(old, new) {
            Some((upsert, remove, sorted)) => out.push(ModelChange::Records { path: path.clone(), upsert, remove, sorted }),
            None => out.push(ModelChange::Set { path: path.clone(), value: target.clone() }),
        },
        _ => out.push(ModelChange::Set { path: path.clone(), value: target.clone() }),
    }
}

/// The records added or changed and the ids removed between two collections of records with unique ids, if
/// applying them rebuilds `new` exactly; otherwise the collection is replaced whole.
fn records_change(old: &[Value], new: &[Value]) -> Option<(Vec<Value>, Vec<String>, bool)> {
    let old_ids = record_ids(old)?;
    let new_ids = record_ids(new)?;
    let before: BTreeMap<&str, &Value> = old_ids.iter().copied().zip(old.iter()).collect();
    let after: BTreeSet<&str> = new_ids.iter().copied().collect();
    let upsert: Vec<Value> = new_ids
        .iter()
        .zip(new.iter())
        .filter(|(id, record)| before.get(*id) != Some(record))
        .map(|(_, record)| record.clone())
        .collect();
    let remove: Vec<String> = old_ids.iter().filter(|id| !after.contains(*id)).map(|id| (*id).to_owned()).collect();
    let sorted = new_ids.windows(2).all(|pair| pair[0] < pair[1]);
    let mut rebuilt = old.to_vec();
    apply_records(&mut rebuilt, &upsert, &remove, sorted).ok()?;
    (rebuilt == new).then_some((upsert, remove, sorted))
}

/// Each record's id, if every record is an object with a string id and no id repeats.
fn record_ids(records: &[Value]) -> Option<Vec<&str>> {
    let mut seen = BTreeSet::new();
    records
        .iter()
        .map(|record| record.get("id").and_then(Value::as_str).filter(|id| seen.insert(*id)))
        .collect()
}

fn apply_records(records: &mut Vec<Value>, upsert: &[Value], remove: &[String], sorted: bool) -> Result<(), String> {
    let removed: BTreeSet<&str> = remove.iter().map(String::as_str).collect();
    let mut replacements: BTreeMap<&str, &Value> = BTreeMap::new();
    for record in upsert {
        let id = record.get("id").and_then(Value::as_str).ok_or("a model delta adds a record without an id")?;
        if removed.contains(id) || replacements.insert(id, record).is_some() {
            return Err(format!("a model delta changes record {id} twice"));
        }
    }
    let mut found = BTreeSet::new();
    let mut rebuilt = Vec::with_capacity(records.len() + upsert.len());
    for record in records.drain(..) {
        let id = record.get("id").and_then(Value::as_str).ok_or("a model delta changes a collection without record ids")?.to_owned();
        if !found.insert(id.clone()) {
            return Err(format!("a model delta's base repeats record {id}"));
        }
        if removed.contains(id.as_str()) {
            continue;
        }
        match replacements.remove(id.as_str()) {
            Some(replacement) => rebuilt.push(replacement.clone()),
            None => rebuilt.push(record),
        }
    }
    if let Some(id) = removed.iter().find(|id| !found.contains(**id)) {
        return Err(format!("a model delta removes record {id} which its base does not have"));
    }
    // What is left was added; it follows in the order given.
    for record in upsert {
        if let Some(id) = record.get("id").and_then(Value::as_str) {
            if replacements.remove(id).is_some() {
                rebuilt.push(record.clone());
            }
        }
    }
    if sorted {
        rebuilt.sort_by(|a, b| a.get("id").and_then(Value::as_str).cmp(&b.get("id").and_then(Value::as_str)));
    }
    *records = rebuilt;
    Ok(())
}

fn object_at<'a>(value: &'a mut Value, path: &[String]) -> Result<&'a mut serde_json::Map<String, Value>, String> {
    let mut current = value;
    for key in path {
        current = current
            .as_object_mut()
            .and_then(|object| object.get_mut(key))
            .ok_or_else(|| format!("a model delta reaches {} which its base does not have", path.join(".")))?;
    }
    current.as_object_mut().ok_or_else(|| format!("a model delta expects an object at {}", path.join(".")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rebuilds(base: &Value, target: &Value) -> ModelDelta {
        let delta = compute(base, target).expect("a delta rebuilds the target");
        let mut rebuilt = base.clone();
        apply(&mut rebuilt, &delta).unwrap();
        assert_eq!(&rebuilt, target);
        let stored: ModelDelta = serde_json::from_str(&serde_json::to_string(&delta).unwrap()).unwrap();
        assert_eq!(stored, delta, "a delta survives storage unchanged");
        delta
    }

    fn model(events: Vec<Value>) -> Value {
        json!({ "schema": "life-sim-rust-model/v1", "id": "story", "time_unit": "year",
            "revision": { "number": 3, "previous_model_hash": "a", "reason": "r", "provenance": [] },
            "processes": [{ "id": "p", "value_type": "number" }],
            "meaning_model": { "events": events, "normalized_cuts": [] } })
    }

    #[test]
    fn an_identical_revision_has_no_changes() {
        let base = model(vec![json!({ "id": "a" })]);
        assert!(rebuilds(&base, &base).changes.is_empty());
    }

    #[test]
    fn a_small_revision_keeps_only_what_changed() {
        let events: Vec<Value> = (0..400).map(|i| json!({ "id": format!("ev.{i:04}"), "description": "x".repeat(200) })).collect();
        let base = model(events.clone());
        let mut changed = events.clone();
        changed[17]["description"] = json!("a revised description");
        changed.remove(40);
        changed.push(json!({ "id": "ev.9999", "description": "added" }));
        let mut target = model(changed);
        target["revision"] = json!({ "number": 4, "previous_model_hash": "b", "reason": "s", "provenance": ["p"] });
        let delta = rebuilds(&base, &target);
        let full = serde_json::to_vec(&target).unwrap().len();
        let kept = serde_json::to_vec(&delta).unwrap().len();
        assert!(kept * 50 < full, "a three-record change keeps {kept} of {full} bytes");
        assert!(delta.changes.iter().any(|change| matches!(change, ModelChange::Records { upsert, remove, sorted: true, .. }
            if upsert.len() == 2 && remove == &vec!["ev.0040".to_owned()])));
    }

    #[test]
    fn keys_added_removed_and_nested_values_are_rebuilt() {
        let base = json!({ "a": 1, "b": { "c": [1, 2], "d": "x" }, "gone": true });
        let target = json!({ "a": 2, "b": { "c": [2, 1], "e": null }, "new": { "f": [] } });
        rebuilds(&base, &target);
    }

    #[test]
    fn an_unsorted_collection_with_an_insertion_inside_it_is_still_rebuilt_exactly() {
        let base = json!({ "items": [{ "id": "z" }, { "id": "a" }, { "id": "m" }] });
        let target = json!({ "items": [{ "id": "z" }, { "id": "q" }, { "id": "a" }, { "id": "m" }] });
        let delta = rebuilds(&base, &target);
        assert!(matches!(&delta.changes[0], ModelChange::Set { .. }), "the collection is replaced whole when its order cannot be kept");
    }

    #[test]
    fn collections_without_unique_ids_are_replaced_whole() {
        let base = json!({ "a": [{ "id": "x" }, { "id": "x" }], "b": [1, 2, 3], "c": [{ "name": "n" }] });
        let target = json!({ "a": [{ "id": "x" }], "b": [1, 2], "c": [{ "name": "m" }] });
        let delta = rebuilds(&base, &target);
        assert!(delta.changes.iter().all(|change| matches!(change, ModelChange::Set { .. })));
    }

    #[test]
    fn a_delta_that_does_not_fit_its_base_is_refused() {
        let base = json!({ "items": [{ "id": "a" }] });
        let wrong = ModelDelta { schema: MODEL_DELTA_SCHEMA.to_owned(), changes: vec![ModelChange::Records {
            path: vec!["items".to_owned()], upsert: vec![], remove: vec!["missing".to_owned()], sorted: true }] };
        assert!(apply(&mut base.clone(), &wrong).unwrap_err().contains("missing"));
        let unset = ModelDelta { schema: MODEL_DELTA_SCHEMA.to_owned(), changes: vec![ModelChange::Unset { path: vec!["nope".to_owned()] }] };
        assert!(apply(&mut base.clone(), &unset).is_err());
        let schema = ModelDelta { schema: "other".to_owned(), changes: vec![] };
        assert!(apply(&mut base.clone(), &schema).is_err());
        let twice = ModelDelta { schema: MODEL_DELTA_SCHEMA.to_owned(), changes: vec![ModelChange::Records {
            path: vec!["items".to_owned()], upsert: vec![json!({ "id": "a", "v": 1 })], remove: vec!["a".to_owned()], sorted: false }] };
        assert!(apply(&mut base.clone(), &twice).is_err());
    }

    /// A small deterministic generator, so the randomized round trips are reproducible without a dependency.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }
    }

    fn random_value(rng: &mut Rng, depth: u32) -> Value {
        match if depth == 0 { rng.below(4) } else { rng.below(7) } {
            0 => Value::Null,
            1 => json!(rng.below(100) as f64 / 7.0),
            2 => json!(format!("s{}", rng.below(50))),
            3 => json!(rng.below(2) == 0),
            4 => {
                let mut object = serde_json::Map::new();
                for _ in 0..rng.below(5) {
                    object.insert(format!("k{}", rng.below(8)), random_value(rng, depth - 1));
                }
                Value::Object(object)
            }
            5 => {
                // A collection of records with unique ids, sometimes sorted.
                let mut ids: Vec<u64> = (0..rng.below(8)).map(|_| rng.below(30)).collect();
                ids.sort();
                ids.dedup();
                if rng.below(3) == 0 {
                    ids.reverse();
                }
                Value::Array(ids.into_iter().map(|id| json!({ "id": format!("r{id:02}"), "v": random_value(rng, depth - 1) })).collect())
            }
            _ => Value::Array((0..rng.below(4)).map(|_| random_value(rng, depth - 1)).collect()),
        }
    }

    fn mutate(rng: &mut Rng, value: &mut Value, depth: u32) {
        match value {
            Value::Object(object) if !object.is_empty() && rng.below(4) != 0 => {
                let keys: Vec<String> = object.keys().cloned().collect();
                let key = &keys[rng.below(keys.len() as u64) as usize];
                match rng.below(5) {
                    0 => { object.remove(key); }
                    1 => { object.insert(format!("n{}", rng.below(9)), random_value(rng, depth)); }
                    _ => mutate(rng, object.get_mut(key).unwrap(), depth.saturating_sub(1)),
                }
            }
            Value::Array(items) if !items.is_empty() && rng.below(4) != 0 => {
                let at = rng.below(items.len() as u64) as usize;
                match rng.below(4) {
                    0 => { items.remove(at); }
                    1 => { let copy = items[at].clone(); items.push(copy); }
                    _ => mutate(rng, &mut items[at], depth.saturating_sub(1)),
                }
            }
            _ => *value = random_value(rng, depth),
        }
    }

    #[test]
    fn randomized_revisions_are_always_rebuilt_exactly() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        for _ in 0..3_000 {
            let base = random_value(&mut rng, 4);
            let mut target = base.clone();
            for _ in 0..1 + rng.below(4) {
                mutate(&mut rng, &mut target, 4);
            }
            if let Some(delta) = compute(&base, &target) {
                let mut rebuilt = base.clone();
                apply(&mut rebuilt, &delta).unwrap();
                assert_eq!(rebuilt, target);
            } else {
                panic!("no delta for {base} -> {target}");
            }
        }
    }
}
