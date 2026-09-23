//! Shared graph algorithms. Structural checks use petgraph rather than a
//! hand-written copy per graph; an error names one cycle so a modeler can
//! find and break it.

use crate::{error, EngineResult};
use petgraph::algo::{tarjan_scc, toposort};
use petgraph::graphmap::DiGraphMap;
use std::collections::{BTreeMap, BTreeSet};

/// Longest cycle an error message spells out before eliding the rest.
const MAX_REPORTED_CYCLE: usize = 8;

/// Refuses a directed graph with a cycle. Edges must name listed nodes;
/// parallel edges are allowed and a self-edge is a cycle.
pub(crate) fn ensure_acyclic<'a>(
    nodes: impl IntoIterator<Item = &'a str>,
    edges: impl IntoIterator<Item = (&'a str, &'a str)>,
    label: &str,
) -> EngineResult<()> {
    let mut graph = DiGraphMap::<&str, ()>::new();
    for node in nodes {
        graph.add_node(node);
    }
    for (source, target) in edges {
        graph.add_edge(source, target, ());
    }
    match toposort(&graph, None) {
        Ok(_) => Ok(()),
        Err(cycle) => Err(error(format!(
            "{label} must be acyclic; this cycle must be broken: {}",
            describe_cycle(&graph, cycle.node_id())
        ))),
    }
}

/// One cycle through `start`, in edge order and returning to `start`.
fn describe_cycle(graph: &DiGraphMap<&str, ()>, start: &str) -> String {
    let component: BTreeSet<&str> = tarjan_scc(graph)
        .into_iter()
        .find(|component| component.contains(&start))
        .map(|component| component.into_iter().collect())
        .unwrap_or_default();
    // Breadth-first search inside the strongly connected component finds the
    // shortest path from start back to start, deterministic for sorted neighbours.
    let mut parent: BTreeMap<&str, &str> = BTreeMap::new();
    let mut frontier = vec![start];
    let mut closing = None;
    'search: while !frontier.is_empty() {
        let mut next = Vec::new();
        for node in frontier {
            let mut neighbours: Vec<&str> = graph.neighbors(node).collect();
            neighbours.sort_unstable();
            for neighbour in neighbours {
                if neighbour == start {
                    closing = Some(node);
                    break 'search;
                }
                if component.contains(neighbour) && !parent.contains_key(neighbour) {
                    parent.insert(neighbour, node);
                    next.push(neighbour);
                }
            }
        }
        frontier = next;
    }
    let mut path = vec![start];
    if let Some(mut node) = closing {
        let mut reversed = Vec::new();
        while node != start {
            reversed.push(node);
            node = parent[node];
        }
        path.extend(reversed.into_iter().rev());
    }
    path.push(start);
    if path.len() > MAX_REPORTED_CYCLE + 1 {
        let shown = path[..MAX_REPORTED_CYCLE].join(" -> ");
        return format!("{shown} -> ... ({} records)", path.len() - 1);
    }
    path.join(" -> ")
}

#[cfg(test)]
mod tests {
    use super::ensure_acyclic;

    #[test]
    fn an_acyclic_graph_passes_and_a_cycle_is_named_in_edge_order() {
        assert!(ensure_acyclic(["a", "b", "c"], [("a", "b"), ("b", "c"), ("a", "c")], "test graph").is_ok());
        let message = ensure_acyclic(["a", "b", "c", "d"], [("a", "b"), ("b", "c"), ("c", "a"), ("c", "d")], "test graph")
            .unwrap_err()
            .to_string();
        assert!(message.contains("test graph must be acyclic"), "{message}");
        let cycle = message.split("broken: ").nth(1).expect("the cycle is spelled out");
        let names: Vec<&str> = cycle.split(" -> ").collect();
        assert_eq!(names.first(), names.last(), "the cycle returns to where it starts: {cycle}");
        assert_eq!(names.len(), 4, "a three-record cycle: {cycle}");
    }

    #[test]
    fn a_self_edge_is_a_cycle() {
        let message = ensure_acyclic(["a"], [("a", "a")], "test graph").unwrap_err().to_string();
        assert!(message.ends_with("a -> a"), "{message}");
    }
}
