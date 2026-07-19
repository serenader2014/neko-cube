export type FlowNodeType = "source" | "domain" | "rule" | "group" | "proxy" | "direct";
export type FlowNodeAccumulator = {
  id: string;
  label: string;
  layer: number;
  nodeType: FlowNodeType;
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
};
export type FlowEdgeAccumulator = {
  id: string;
  source: string;
  target: string;
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
};

export function flowNodeTypeForPart(index: number, parts: string[]): FlowNodeType {
  const value = parts[index]?.trim().toUpperCase();
  if (index === parts.length - 1) {
    return value === "DIRECT" ? "direct" : "proxy";
  }
  return "group";
}

export function normalizeFlowProxyParts(parts: string[]) {
  return parts.length > 0 ? [...parts].reverse() : ["DIRECT"];
}

export function upsertFlowNode(
  nodes: Map<string, FlowNodeAccumulator>,
  payload: Omit<FlowNodeAccumulator, "uploadBytes" | "downloadBytes" | "connectionCount">,
  uploadBytes: number,
  downloadBytes: number,
  connectionCount: number,
) {
  const node = nodes.get(payload.id) ?? {
    ...payload,
    uploadBytes: 0,
    downloadBytes: 0,
    connectionCount: 0,
  };
  node.uploadBytes += uploadBytes;
  node.downloadBytes += downloadBytes;
  node.connectionCount += connectionCount;
  nodes.set(payload.id, node);
}

export function upsertFlowEdge(
  edges: Map<string, FlowEdgeAccumulator>,
  source: string,
  target: string,
  uploadBytes: number,
  downloadBytes: number,
  connectionCount: number,
) {
  const edgeId = `${source}->${target}`;
  const edge = edges.get(edgeId) ?? {
    id: edgeId,
    source,
    target,
    uploadBytes: 0,
    downloadBytes: 0,
    connectionCount: 0,
  };
  edge.uploadBytes += uploadBytes;
  edge.downloadBytes += downloadBytes;
  edge.connectionCount += connectionCount;
  edges.set(edgeId, edge);
}
