import { getRelativeProjectPath, joinRemotePath } from './projectFiles';

export interface ProjectDirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number;
}

export interface ProjectFileNode {
    type: 'file' | 'directory' | 'other';
    name: string;
    path: string;
    relativePath: string;
    size?: number;
    modified?: number;
    depth: number;
    children?: ProjectFileNode[];
    childrenLoaded?: boolean;
    loading?: boolean;
    error?: string | null;
}

export interface FlatProjectRow {
    node: ProjectFileNode;
    key: string;
}

export function createProjectFileNode(entry: ProjectDirectoryEntry, parentPath: string, rootPath: string, depth: number): ProjectFileNode {
    const path = joinRemotePath(parentPath, entry.name);
    return {
        type: entry.type,
        name: entry.name,
        path,
        relativePath: getRelativeProjectPath(path, rootPath),
        size: entry.size,
        modified: entry.modified,
        depth,
        children: entry.type === 'directory' ? [] : undefined,
        childrenLoaded: false,
        error: null,
    };
}

export function sortProjectNodes(nodes: ProjectFileNode[]): ProjectFileNode[] {
    return [...nodes].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });
}

export function updateProjectNode(nodes: ProjectFileNode[], path: string, updater: (node: ProjectFileNode) => ProjectFileNode): ProjectFileNode[] {
    return nodes.map((node) => {
        if (node.path === path) {
            return updater(node);
        }
        if (node.children) {
            return { ...node, children: updateProjectNode(node.children, path, updater) };
        }
        return node;
    });
}

export function flattenProjectNodes(nodes: ProjectFileNode[], expanded: Set<string>, rows: FlatProjectRow[] = []): FlatProjectRow[] {
    for (const node of nodes) {
        rows.push({ node, key: node.path });
        if (node.type === 'directory' && expanded.has(node.path) && node.children) {
            flattenProjectNodes(node.children, expanded, rows);
        }
    }
    return rows;
}
