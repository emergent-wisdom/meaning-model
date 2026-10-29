//! Access scopes: the one rule for what a caller may see.
//!
//! A process, claim, narrative node or narrative edge may name access scopes. One that names none is visible to every
//! caller; one that names some is visible only to a caller holding at least one of them, in any order. Every read
//! (graphs, views, transition queries, narrative queries, renders and exports) applies this rule, and so does the
//! check that a narrative edge to a private anchor carries one of the anchor's scopes. Scopes are projection guards,
//! not authenticated confidentiality.

/// Whether an item that names the `required` scopes is visible to a caller holding the `held` ones.
pub(crate) fn visible_to(required: &[String], held: &[String]) -> bool {
    required.is_empty() || required.iter().any(|scope| held.contains(scope))
}

#[cfg(test)]
mod tests {
    use super::visible_to;

    fn scopes(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn an_item_without_scopes_is_visible_to_everyone() {
        assert!(visible_to(&[], &[]));
        assert!(visible_to(&[], &scopes(&["any"])));
    }

    #[test]
    fn a_scoped_item_is_visible_to_a_caller_holding_any_one_of_its_scopes() {
        let required = scopes(&["b", "a"]);
        assert!(visible_to(&required, &scopes(&["z", "a"])));
        assert!(visible_to(&required, &scopes(&["b"])));
        assert!(!visible_to(&required, &scopes(&["c"])));
        assert!(!visible_to(&required, &[]));
    }
}
