import { describe, expect, it } from 'vitest';
import {
    createProjectFileNode,
    flattenProjectNodes,
    sortProjectNodes,
    updateProjectNode,
    type ProjectFileNode,
} from './projectDirectoryTree';

describe('projectDirectoryTree', () => {
    it('creates nodes with absolute and relative paths', () => {
        const node = createProjectFileNode({ name: 'App.tsx', type: 'file', size: 10 }, '/repo/src', '/repo', 1);
        expect(node).toMatchObject({
            type: 'file',
            name: 'App.tsx',
            path: '/repo/src/App.tsx',
            relativePath: 'src/App.tsx',
            size: 10,
            depth: 1,
        });
    });

    it('sorts directories before files by name', () => {
        const nodes = [
            createProjectFileNode({ name: 'z.txt', type: 'file' }, '/repo', '/repo', 0),
            createProjectFileNode({ name: 'src', type: 'directory' }, '/repo', '/repo', 0),
            createProjectFileNode({ name: 'a.txt', type: 'file' }, '/repo', '/repo', 0),
            createProjectFileNode({ name: 'docs', type: 'directory' }, '/repo', '/repo', 0),
        ];
        expect(sortProjectNodes(nodes).map((node) => node.name)).toEqual(['docs', 'src', 'a.txt', 'z.txt']);
    });

    it('updates nested nodes immutably', () => {
        const child = createProjectFileNode({ name: 'App.tsx', type: 'file' }, '/repo/src', '/repo', 1);
        const root: ProjectFileNode = {
            ...createProjectFileNode({ name: 'src', type: 'directory' }, '/repo', '/repo', 0),
            children: [child],
        };
        const updated = updateProjectNode([root], '/repo/src/App.tsx', (node) => ({ ...node, loading: true }));
        expect(updated[0]).not.toBe(root);
        expect(updated[0].children?.[0]).toMatchObject({ path: '/repo/src/App.tsx', loading: true });
        expect(root.children?.[0].loading).toBeUndefined();
    });

    it('flattens only expanded directory children', () => {
        const child = createProjectFileNode({ name: 'App.tsx', type: 'file' }, '/repo/src', '/repo', 1);
        const root: ProjectFileNode = {
            ...createProjectFileNode({ name: 'src', type: 'directory' }, '/repo', '/repo', 0),
            children: [child],
        };
        expect(flattenProjectNodes([root], new Set()).map((row) => row.key)).toEqual(['/repo/src']);
        expect(flattenProjectNodes([root], new Set(['/repo/src'])).map((row) => row.key)).toEqual(['/repo/src', '/repo/src/App.tsx']);
    });
});
