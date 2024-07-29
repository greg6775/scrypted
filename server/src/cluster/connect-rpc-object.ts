export interface ClusterObject {
    id: string;
    address: string;
    port: number;
    proxyId: string;
    sourceAddress: string;
    sourcePort: number;
    sha256: string;
}

export type ConnectRPCObject = (o: ClusterObject) => Promise<any>;
