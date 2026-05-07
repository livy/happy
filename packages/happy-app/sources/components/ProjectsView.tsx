import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sessionListDirectory, sessionReadFile, sessionRipgrep } from '@/sync/ops';
import { useAllSessions, useProjects } from '@/sync/storage';
import type { Project } from '@/sync/projectManager';
import type { Session } from '@/sync/storageTypes';
import { openDownloadedFileExternally, saveSessionFileToDevice, type SessionFileDownloadProgress } from '@/utils/sessionFileDownloads';
import {
    TEXT_PREVIEW_MAX_BYTES,
    decodeBase64ToBytes,
    decodeUtf8Bytes,
    formatFileSize,
    getFileName,
    getLanguageFromPath,
    getRelativeProjectPath,
    isKnownBinaryFile,
    isLikelyBinaryBytes,
    joinRemotePath,
    shouldPreviewAsText,
} from '@/utils/projectFiles';
import { getProjectDownloadRecord, saveProjectDownloadRecord, type ProjectDownloadRecord } from '@/utils/projectDownloadRecords';
import {
    createProjectFileNode,
    flattenProjectNodes,
    sortProjectNodes,
    updateProjectNode,
    type FlatProjectRow,
    type ProjectFileNode,
} from '@/utils/projectDirectoryTree';

interface SelectedFile {
    path: string;
    relativePath: string;
    name: string;
    size?: number;
}

interface SearchResult {
    name: string;
    path: string;
    relativePath: string;
}

const INDENT = 16;
const SEARCH_LIMIT = 100;
const DIRECTORY_CACHE_TTL_MS = 30 * 1000;

function getProjectDisplayName(project: Project): string {
    const parts = project.key.path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || project.key.path || 'Project';
}

function chooseProjectSession(project: Project, sessions: Session[]): Session | null {
    const projectSessions = sessions
        .filter((session) => project.sessionIds.includes(session.id))
        .sort((a, b) => {
            if (a.active !== b.active) {
                return a.active ? -1 : 1;
            }
            return (b.updatedAt || b.activeAt || 0) - (a.updatedAt || a.activeAt || 0);
        });
    return projectSessions[0] ?? null;
}

interface DirectoryCacheEntry {
    nodes: ProjectFileNode[];
    loadedAt: number;
}

function formatModified(timestamp?: number): string {
    if (!timestamp) {
        return '';
    }
    return new Date(timestamp).toLocaleDateString();
}

export const ProjectsView = React.memo(function ProjectsView() {
    const { theme } = useUnistyles();
    const projects = useProjects();
    const sessions = useAllSessions();
    const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null);
    const [rootNodes, setRootNodes] = React.useState<ProjectFileNode[]>([]);
    const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
    const [isLoadingRoot, setIsLoadingRoot] = React.useState(false);
    const [rootError, setRootError] = React.useState<string | null>(null);
    const [query, setQuery] = React.useState('');
    const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    const [selectedFile, setSelectedFile] = React.useState<SelectedFile | null>(null);
    const lastLoadedRootKey = React.useRef<string | null>(null);
    const directoryCache = React.useRef(new Map<string, DirectoryCacheEntry>());

    const selectedProject = React.useMemo(() => {
        if (projects.length === 0) return null;
        return projects.find((project) => project.id === selectedProjectId) ?? projects[0];
    }, [projects, selectedProjectId]);

    const selectedSession = React.useMemo(() => {
        return selectedProject ? chooseProjectSession(selectedProject, sessions) : null;
    }, [selectedProject, sessions]);

    const selectedProjectPath = selectedProject?.key.path ?? null;
    const selectedSessionId = selectedSession?.id ?? null;
    const selectedRootKey = selectedProjectPath && selectedSessionId ? `${selectedSessionId}:${selectedProjectPath}` : null;

    React.useEffect(() => {
        if (projects.length === 0) {
            setSelectedProjectId(null);
            return;
        }
        if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) {
            setSelectedProjectId(projects[0].id);
        }
    }, [projects, selectedProjectId]);

    const loadDirectory = React.useCallback(async (path: string, depth: number, options?: { force?: boolean }) => {
        if (!selectedSessionId || !selectedProjectPath) {
            return [];
        }
        const cacheKey = `${selectedSessionId}:${path}`;
        const cached = directoryCache.current.get(cacheKey);
        if (!options?.force && cached && Date.now() - cached.loadedAt < DIRECTORY_CACHE_TTL_MS) {
            return cached.nodes;
        }
        const response = await sessionListDirectory(selectedSessionId, path);
        if (!response.success || !response.entries) {
            throw new Error(response.error || t('projects.failedToLoadDirectory'));
        }
        const nodes = sortProjectNodes(response.entries.map((entry) => createProjectFileNode(entry, path, selectedProjectPath, depth)));
        directoryCache.current.set(cacheKey, { nodes, loadedAt: Date.now() });
        return nodes;
    }, [selectedProjectPath, selectedSessionId]);

    const loadRoot = React.useCallback(async (options?: { force?: boolean }) => {
        if (!selectedProjectPath || !selectedSessionId || !selectedRootKey) {
            setRootNodes([]);
            lastLoadedRootKey.current = null;
            return;
        }
        if (!options?.force && lastLoadedRootKey.current === selectedRootKey) {
            return;
        }
        const isRootChange = lastLoadedRootKey.current !== selectedRootKey;
        if (isRootChange) {
            setRootNodes([]);
            setExpanded(new Set());
        }
        setIsLoadingRoot(true);
        setRootError(null);
        setSelectedFile(null);
        try {
            const nodes = await loadDirectory(selectedProjectPath, 0, { force: options?.force });
            setRootNodes(nodes);
            setExpanded(new Set());
            lastLoadedRootKey.current = selectedRootKey;
        } catch (error) {
            setRootError(error instanceof Error ? error.message : t('projects.unableToLoadProject'));
            if (isRootChange || rootNodes.length === 0) {
                setRootNodes([]);
            }
        } finally {
            setIsLoadingRoot(false);
        }
    }, [loadDirectory, rootNodes.length, selectedProjectPath, selectedRootKey, selectedSessionId]);

    React.useEffect(() => {
        void loadRoot();
    }, [loadRoot]);

    React.useEffect(() => {
        if (!selectedProjectPath || !selectedSessionId || !query.trim()) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        let cancelled = false;
        const handle = setTimeout(() => {
            const search = async () => {
                setIsSearching(true);
                try {
                    const response = await sessionRipgrep(selectedSessionId, ['--files', '--follow'], selectedProjectPath);
                    if (cancelled) return;
                    if (!response.success || !response.stdout) {
                        setSearchResults([]);
                        return;
                    }
                    const needle = query.trim().toLowerCase();
                    const results = response.stdout
                        .split('\n')
                        .filter(Boolean)
                        .filter((path) => path.toLowerCase().includes(needle))
                        .slice(0, SEARCH_LIMIT)
                        .map((relativePath) => ({
                            name: getFileName(relativePath),
                            relativePath,
                            path: joinRemotePath(selectedProjectPath, relativePath),
                        }));
                    setSearchResults(results);
                } catch (error) {
                    if (!cancelled) {
                        setSearchResults([]);
                    }
                } finally {
                    if (!cancelled) {
                        setIsSearching(false);
                    }
                }
            };
            void search();
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [query, selectedProjectPath, selectedSessionId]);

    const toggleDirectory = React.useCallback(async (node: ProjectFileNode) => {
        if (node.type !== 'directory') return;

        setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(node.path)) {
                next.delete(node.path);
            } else {
                next.add(node.path);
            }
            return next;
        });

        if (node.childrenLoaded || node.loading) {
            return;
        }

        setRootNodes((previous) => updateProjectNode(previous, node.path, (current) => ({ ...current, loading: true, error: null })));
        try {
            const children = await loadDirectory(node.path, node.depth + 1);
            setRootNodes((previous) => updateProjectNode(previous, node.path, (current) => ({
                ...current,
                children,
                childrenLoaded: true,
                loading: false,
                error: null,
            })));
        } catch (error) {
            setRootNodes((previous) => updateProjectNode(previous, node.path, (current) => ({
                ...current,
                loading: false,
                error: error instanceof Error ? error.message : t('projects.failedToLoadDirectory'),
            })));
        }
    }, [loadDirectory]);

    const openFile = React.useCallback((file: SelectedFile) => {
        setSelectedFile(file);
    }, []);

    const flatRows = React.useMemo(() => flattenProjectNodes(rootNodes, expanded), [expanded, rootNodes]);
    const showSearch = query.trim().length > 0;
    const showFullScreenLoading = isLoadingRoot && flatRows.length === 0;
    const showFullScreenError = !!rootError && flatRows.length === 0;

    if (!selectedProject || !selectedSession) {
        return (
            <View style={styles.emptyContainer}>
                <Octicons name="repo" size={36} color={theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>{t('projects.noProjectsTitle')}</Text>
                <Text style={styles.emptySubtitle}>{t('projects.noProjectsSubtitle')}</Text>
            </View>
        );
    }

    if (selectedFile) {
        return (
            <ProjectFilePreview
                sessionId={selectedSession.id}
                file={selectedFile}
                onBack={() => setSelectedFile(null)}
            />
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.projectHeader}>
                <View style={styles.projectTitleRow}>
                    <View style={styles.projectTitleTextWrap}>
                        <Text style={styles.projectTitle} numberOfLines={1}>{getProjectDisplayName(selectedProject)}</Text>
                        <Text style={styles.projectPath} numberOfLines={1}>{selectedProject.key.path}</Text>
                    </View>
                    <View style={[styles.statusPill, selectedSession.active ? styles.statusPillOnline : styles.statusPillOffline]}>
                        <Text style={[styles.statusText, selectedSession.active ? styles.statusTextOnline : styles.statusTextOffline]}>
                            {selectedSession.active ? t('projects.online') : t('projects.offline')}
                        </Text>
                    </View>
                </View>
                {projects.length > 1 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectPicker}>
                        {projects.map((project) => {
                            const active = project.id === selectedProject.id;
                            return (
                                <Pressable
                                    key={project.id}
                                    onPress={() => setSelectedProjectId(project.id)}
                                    style={[styles.projectChip, active && styles.projectChipActive]}
                                >
                                    <Text style={[styles.projectChipText, active && styles.projectChipTextActive]} numberOfLines={1}>
                                        {getProjectDisplayName(project)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                ) : null}
                <View style={styles.searchWrap}>
                    <Octicons name="search" size={14} color={theme.colors.textSecondary} style={styles.searchIcon} />
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder={t('projects.searchPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        style={styles.searchInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                    />
                </View>
            </View>

            {showSearch ? (
                <FlatList
                    data={searchResults}
                    keyExtractor={(item) => item.path}
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={isSearching ? <LoadingInline label={t('projects.searching')} /> : null}
                    ListEmptyComponent={!isSearching ? <EmptyInline title={t('projects.noFilesFound')} subtitle={t('projects.tryDifferentTerm')} /> : null}
                    renderItem={({ item }) => (
                        <FileSearchRow
                            item={item}
                            onPress={() => openFile({ path: item.path, relativePath: item.relativePath, name: item.name })}
                        />
                    )}
                />
            ) : showFullScreenLoading ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={styles.loadingText}>{t('projects.loadingProject')}</Text>
                </View>
            ) : showFullScreenError ? (
                <View style={styles.centerContainer}>
                    <Text style={styles.errorTitle}>{t('projects.unableToLoadProject')}</Text>
                    <Text style={styles.errorSubtitle}>{rootError}</Text>
                    <Pressable onPress={() => void loadRoot({ force: true })} style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
                    </Pressable>
                </View>
            ) : (
                <FlatList
                    data={flatRows}
                    keyExtractor={(item) => item.key}
                    refreshControl={<RefreshControl refreshing={isLoadingRoot} onRefresh={() => void loadRoot({ force: true })} />}
                    ListEmptyComponent={<EmptyInline title={t('projects.emptyProject')} subtitle={t('projects.emptyProjectSubtitle')} />}
                    renderItem={({ item }) => (
                        <ProjectTreeRow
                            row={item}
                            expanded={expanded.has(item.node.path)}
                            onToggleDirectory={toggleDirectory}
                            onOpenFile={openFile}
                        />
                    )}
                />
            )}
        </View>
    );
});

function LoadingInline({ label }: { label: string }) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.inlineState}>
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            <Text style={styles.inlineStateText}>{label}</Text>
        </View>
    );
}

function EmptyInline({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineTitle}>{title}</Text>
            <Text style={styles.emptyInlineSubtitle}>{subtitle}</Text>
        </View>
    );
}

const ProjectTreeRow = React.memo(function ProjectTreeRow({
    row,
    expanded,
    onToggleDirectory,
    onOpenFile,
}: {
    row: FlatProjectRow;
    expanded: boolean;
    onToggleDirectory: (node: ProjectFileNode) => void;
    onOpenFile: (file: SelectedFile) => void;
}) {
    const { theme } = useUnistyles();
    const node = row.node;
    const leftPadding = 16 + node.depth * INDENT;

    if (node.type === 'directory') {
        return (
            <View>
                <Pressable
                    onPress={() => onToggleDirectory(node)}
                    style={({ pressed }) => [styles.row, { paddingLeft: leftPadding }, pressed && styles.rowPressed]}
                >
                    <Octicons name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={theme.colors.textSecondary} />
                    <Octicons name="file-directory" size={18} color={theme.colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.dirName} numberOfLines={1}>{node.name}</Text>
                    {node.loading ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : null}
                </Pressable>
                {node.error ? <Text style={[styles.rowError, { marginLeft: leftPadding + 50 }]}>{node.error}</Text> : null}
            </View>
        );
    }

    return (
        <Pressable
            onPress={() => onOpenFile({ path: node.path, relativePath: node.relativePath, name: node.name, size: node.size })}
            style={({ pressed }) => [styles.row, { paddingLeft: leftPadding + 32 }, pressed && styles.rowPressed]}
        >
            <FileIcon fileName={node.name} size={18} />
            <View style={styles.fileTextWrap}>
                <Text style={styles.fileName} numberOfLines={1}>{node.name}</Text>
                <Text style={styles.fileMeta} numberOfLines={1}>
                    {[formatFileSize(node.size), formatModified(node.modified)].filter(Boolean).join(' • ')}
                </Text>
            </View>
        </Pressable>
    );
});

function FileSearchRow({ item, onPress }: { item: SearchResult; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [styles.row, styles.searchRow, pressed && styles.rowPressed]}>
            <FileIcon fileName={item.name} size={18} />
            <View style={styles.fileTextWrap}>
                <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.fileMeta} numberOfLines={1}>{item.relativePath}</Text>
            </View>
        </Pressable>
    );
}

function ProjectFilePreview({ sessionId, file, onBack }: { sessionId: string; file: SelectedFile; onBack: () => void }) {
    const { theme } = useUnistyles();
    const [content, setContent] = React.useState<string | null>(null);
    const [isBinary, setIsBinary] = React.useState(() => isKnownBinaryFile(file.path));
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [allowLargePreview, setAllowLargePreview] = React.useState(false);
    const [isWorking, setIsWorking] = React.useState(false);
    const [downloadProgress, setDownloadProgress] = React.useState<SessionFileDownloadProgress | null>(null);
    const [downloadRecord, setDownloadRecord] = React.useState<ProjectDownloadRecord | null>(null);

    const isLarge = (file.size ?? 0) > TEXT_PREVIEW_MAX_BYTES;
    const canTryTextPreview = shouldPreviewAsText(file.path, file.size);
    const language = getLanguageFromPath(file.path);

    const loadFile = React.useCallback(async () => {
        if (!canTryTextPreview || (isLarge && !allowLargePreview)) {
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await sessionReadFile(sessionId, file.path);
            if (!response.success || typeof response.content !== 'string') {
                throw new Error(response.error || t('projects.failedToReadFile'));
            }
            const bytes = decodeBase64ToBytes(response.content);
            const decoded = decodeUtf8Bytes(bytes);
            if (isLikelyBinaryBytes(bytes, decoded)) {
                setIsBinary(true);
                setContent(null);
            } else {
                setIsBinary(false);
                setContent(decoded);
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : t('projects.failedToReadFile'));
        } finally {
            setIsLoading(false);
        }
    }, [allowLargePreview, canTryTextPreview, file.path, isLarge, sessionId]);

    React.useEffect(() => {
        setContent(null);
        setIsBinary(isKnownBinaryFile(file.path));
        setError(null);
        setAllowLargePreview(false);
        setDownloadProgress(null);
    }, [file.path]);

    React.useEffect(() => {
        void loadFile();
    }, [loadFile]);

    React.useEffect(() => {
        let cancelled = false;
        const loadRecord = async () => {
            const record = await getProjectDownloadRecord(sessionId, file.path);
            if (!cancelled) {
                setDownloadRecord(record);
            }
        };
        void loadRecord();
        return () => {
            cancelled = true;
        };
    }, [file.path, sessionId]);

    const handleCopy = React.useCallback(async () => {
        if (!content) return;
        await Clipboard.setStringAsync(content);
        Modal.alert(t('projects.copied'), t('projects.copiedMessage'));
    }, [content]);

    const handleDownload = React.useCallback(async () => {
        setIsWorking(true);
        setDownloadProgress({ bytesDownloaded: 0, totalBytes: file.size, done: false });
        try {
            const result = await saveSessionFileToDevice(sessionId, file.path, {
                onProgress: setDownloadProgress,
            });
            const record = {
                sessionId,
                remotePath: file.path,
                localUri: result.uri,
                fileName: result.fileName,
                mimeType: result.mimeType,
                downloadedAt: Date.now(),
                size: file.size,
            };
            saveProjectDownloadRecord(record);
            setDownloadRecord(record);
            setDownloadProgress((current) => current ? { ...current, done: true } : null);
            Modal.alert(t('projects.downloaded'), t('projects.downloadedMessage', { fileName: result.fileName }));
        } catch (error) {
            Modal.alert(t('projects.downloadFailed'), error instanceof Error ? error.message : t('projects.downloadFailed'));
        } finally {
            setIsWorking(false);
            setDownloadProgress(null);
        }
    }, [file.path, file.size, sessionId]);

    const handleOpen = React.useCallback(async () => {
        setIsWorking(true);
        setDownloadProgress(downloadRecord ? null : { bytesDownloaded: 0, totalBytes: file.size, done: false });
        try {
            if (downloadRecord) {
                await openDownloadedFileExternally({
                    uri: downloadRecord.localUri,
                    fileName: downloadRecord.fileName,
                    mimeType: downloadRecord.mimeType,
                });
                return;
            }
            const result = await saveSessionFileToDevice(sessionId, file.path, {
                onProgress: setDownloadProgress,
            });
            const record = {
                sessionId,
                remotePath: file.path,
                localUri: result.uri,
                fileName: result.fileName,
                mimeType: result.mimeType,
                downloadedAt: Date.now(),
                size: file.size,
            };
            saveProjectDownloadRecord(record);
            setDownloadRecord(record);
            setDownloadProgress((current) => current ? { ...current, done: true } : null);
            await openDownloadedFileExternally(result);
        } catch (error) {
            Modal.alert(t('projects.openFailed'), error instanceof Error ? error.message : t('projects.openFailed'));
        } finally {
            setIsWorking(false);
            setDownloadProgress(null);
        }
    }, [downloadRecord, file.path, file.size, sessionId]);

    const activeDownloadProgress = downloadProgress;
    const progressTotal = activeDownloadProgress?.totalBytes ?? file.size;
    const progressRatio = activeDownloadProgress && progressTotal && progressTotal > 0
        ? Math.min(1, Math.max(0, activeDownloadProgress.bytesDownloaded / progressTotal))
        : undefined;
    const progressPercent = Math.round((progressRatio ?? 0) * 100);
    const progressLabel = activeDownloadProgress
        ? progressTotal
            ? `${progressPercent}% · ${formatFileSize(activeDownloadProgress.bytesDownloaded)} / ${formatFileSize(progressTotal)}`
            : formatFileSize(activeDownloadProgress.bytesDownloaded)
        : '';

    return (
        <View style={styles.container}>
            <View style={styles.previewHeader}>
                <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
                    <Octicons name="chevron-left" size={22} color={theme.colors.text} />
                </Pressable>
                <FileIcon fileName={file.name} size={22} />
                <View style={styles.previewTitleWrap}>
                    <Text style={styles.previewTitle} numberOfLines={1}>{file.name}</Text>
                    <Text style={styles.previewPath} numberOfLines={1}>{file.relativePath || file.path}</Text>
                </View>
            </View>

            <View style={styles.actionBar}>
                {content ? <ActionButton label={t('common.copy')} icon="copy" onPress={handleCopy} disabled={isWorking} /> : null}
                <ActionButton label={t('common.save')} icon="download" onPress={handleDownload} disabled={isWorking} />
                <ActionButton label={downloadRecord ? t('projects.openDownloaded') : t('projects.openFile')} icon="link-external" onPress={handleOpen} disabled={isWorking} />
            </View>

            {activeDownloadProgress ? (
                <View style={styles.downloadProgressWrap}>
                    <View style={styles.downloadProgressHeader}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={styles.downloadProgressText} numberOfLines={1}>{progressLabel}</Text>
                    </View>
                    <View style={styles.downloadProgressTrack}>
                        <View style={[styles.downloadProgressFill, { width: `${progressPercent}%` }]} />
                    </View>
                </View>
            ) : null}

            {isLoading ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={styles.loadingText}>{t('projects.loadingFile')}</Text>
                </View>
            ) : error ? (
                <View style={styles.centerContainer}>
                    <Text style={styles.errorTitle}>{t('projects.unableToPreviewFile')}</Text>
                    <Text style={styles.errorSubtitle}>{error}</Text>
                    <Pressable onPress={loadFile} style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
                    </Pressable>
                </View>
            ) : isLarge && !allowLargePreview && canTryTextPreview ? (
                <View style={styles.centerContainer}>
                    <Text style={styles.emptyTitle}>{t('projects.largeFile')}</Text>
                    <Text style={styles.emptySubtitle}>
                        {t('projects.largeFilePrompt', { fileName: file.name, size: formatFileSize(file.size) })}
                    </Text>
                    <Pressable onPress={() => setAllowLargePreview(true)} style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>{t('projects.previewAnyway')}</Text>
                    </Pressable>
                </View>
            ) : isBinary || !canTryTextPreview ? (
                <View style={styles.centerContainer}>
                    <Octicons name="file-binary" size={34} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyTitle}>{t('projects.previewUnavailable')}</Text>
                    <Text style={styles.emptySubtitle}>{t('projects.previewUnavailableSubtitle')}</Text>
                    <Text style={styles.fileMeta}>{formatFileSize(file.size)}</Text>
                </View>
            ) : content !== null ? (
                <ScrollView style={styles.previewBody} contentContainerStyle={styles.previewBodyContent}>
                    {content.length > 0 ? (
                        <SimpleSyntaxHighlighter code={content} language={language} selectable />
                    ) : (
                        <Text style={styles.emptyInlineSubtitle}>{t('projects.fileEmpty')}</Text>
                    )}
                </ScrollView>
            ) : null}
        </View>
    );
}

function ActionButton({ label, icon, onPress, disabled }: { label: string; icon: React.ComponentProps<typeof Octicons>['name']; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.actionButton, pressed && !disabled && styles.rowPressed, disabled && styles.actionButtonDisabled]}>
            <Octicons name={icon} size={14} style={styles.actionButtonIcon} />
            <Text style={styles.actionButtonText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: theme.colors.groupped.background,
    },
    projectHeader: {
        backgroundColor: theme.colors.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 10,
    },
    projectTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    projectTitleTextWrap: {
        flex: 1,
    },
    projectTitle: {
        color: theme.colors.text,
        fontSize: 20,
        ...Typography.default('semiBold'),
    },
    projectPath: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
        ...Typography.mono(),
    },
    statusPill: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    statusPillOnline: {
        backgroundColor: theme.colors.status.connected + '20',
    },
    statusPillOffline: {
        backgroundColor: theme.colors.input.background,
    },
    statusText: {
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    statusTextOnline: {
        color: theme.colors.status.connected,
    },
    statusTextOffline: {
        color: theme.colors.textSecondary,
    },
    projectPicker: {
        marginTop: 10,
    },
    projectChip: {
        maxWidth: 160,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: theme.colors.input.background,
        marginRight: 8,
    },
    projectChipActive: {
        backgroundColor: theme.colors.text,
    },
    projectChipText: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    projectChipTextActive: {
        color: theme.colors.surface,
    },
    searchWrap: {
        marginTop: 12,
        height: 38,
        borderRadius: 10,
        backgroundColor: theme.colors.input.background,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 15,
        paddingVertical: 0,
        ...Typography.default(),
    },
    row: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 8,
    },
    searchRow: {
        paddingLeft: 16,
    },
    rowPressed: {
        opacity: 0.65,
    },
    rowIcon: {
        marginLeft: 2,
    },
    dirName: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    rowError: {
        color: theme.colors.textDestructive,
        fontSize: 12,
        marginVertical: 4,
        ...Typography.default(),
    },
    fileTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    fileName: {
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default(),
    },
    fileMeta: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
        ...Typography.default(),
    },
    centerContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    loadingText: {
        color: theme.colors.textSecondary,
        marginTop: 12,
        ...Typography.default(),
    },
    errorTitle: {
        color: theme.colors.textDestructive,
        fontSize: 18,
        marginBottom: 8,
        ...Typography.default('semiBold'),
    },
    errorSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 15,
        textAlign: 'center',
        marginBottom: 16,
        ...Typography.default(),
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        backgroundColor: theme.colors.groupped.background,
    },
    emptyTitle: {
        color: theme.colors.text,
        fontSize: 18,
        marginTop: 12,
        marginBottom: 6,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptySubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 15,
        textAlign: 'center',
        ...Typography.default(),
    },
    emptyInline: {
        alignItems: 'center',
        padding: 28,
    },
    emptyInlineTitle: {
        color: theme.colors.text,
        fontSize: 16,
        marginBottom: 6,
        ...Typography.default('semiBold'),
    },
    emptyInlineSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        textAlign: 'center',
        ...Typography.default(),
    },
    inlineState: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        gap: 8,
    },
    inlineStateText: {
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    primaryButton: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        marginTop: 4,
    },
    primaryButtonText: {
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
    previewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    backButton: {
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
    },
    previewTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    previewTitle: {
        color: theme.colors.text,
        fontSize: 17,
        ...Typography.default('semiBold'),
    },
    previewPath: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
        ...Typography.mono(),
    },
    actionBar: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 9,
        backgroundColor: theme.colors.input.background,
    },
    actionButtonDisabled: {
        opacity: 0.5,
    },
    actionButtonIcon: {
        color: theme.colors.text,
    },
    actionButtonText: {
        color: theme.colors.text,
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    downloadProgressWrap: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        gap: 8,
    },
    downloadProgressHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    downloadProgressText: {
        flex: 1,
        color: theme.colors.textSecondary,
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    downloadProgressTrack: {
        height: 4,
        borderRadius: 999,
        overflow: 'hidden',
        backgroundColor: theme.colors.input.background,
    },
    downloadProgressFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: theme.colors.text,
    },
    previewBody: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    previewBodyContent: {
        padding: 16,
    },
}));
