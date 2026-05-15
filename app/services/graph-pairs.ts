import { supabase } from '~/utils/supabase';

export interface GraphPair {
  product_id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  url: string | null;
  type: string | null;
  gender: string | null;
  edge_type: string;
  edge_weight: number;
}

/**
 * Returns products related to the given anchor product IDs via the
 * entity_edges graph. Used by the "Pairs well with" rail on ProductPage.
 *
 * @param anchorIds  One or more product IDs to find connections for.
 * @param k          Maximum number of results (default 12).
 * @param edgeTypes  Which relationship types to traverse.
 */
export async function getGraphPairs(
  anchorIds: string[],
  k = 12,
  edgeTypes: string[] = ['pairs_with', 'same_brand'],
): Promise<GraphPair[]> {
  if (!anchorIds.length) return [];

  const { data, error } = await supabase.rpc('get_graph_pairs', {
    anchor_ids: anchorIds,
    k,
    edge_types: edgeTypes,
  });

  if (error) {
    console.error('[graph-pairs] get_graph_pairs RPC error:', error.message);
    return [];
  }

  return (data ?? []) as GraphPair[];
}
