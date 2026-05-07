import * as React from 'react';
import { DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';
import { Text } from 'react-native';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

function MenuItemText({ children }: { children: string }) {
    return (
        <DropdownMenuItem.Text>
            <Text>{children}</Text>
        </DropdownMenuItem.Text>
    );
}

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const {
        archiveSession,
        canArchive,
        canCopySessionMetadata,
        canShowResume,
        copySessionMetadata,
        openDetails,
        resumeSession,
    } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    return (
        <DropdownMenu>
            <DropdownMenu.Items>
                <DropdownMenuItem onClick={openDetails}>
                    <MenuItemText>Details</MenuItemText>
                </DropdownMenuItem>
                {canArchive && (
                    <DropdownMenuItem onClick={archiveSession}>
                        <MenuItemText>Archive</MenuItemText>
                    </DropdownMenuItem>
                )}
                {canShowResume && (
                    <DropdownMenuItem onClick={resumeSession}>
                        <MenuItemText>Resume</MenuItemText>
                    </DropdownMenuItem>
                )}
                {canCopySessionMetadata && (
                    <DropdownMenuItem onClick={copySessionMetadata}>
                        <MenuItemText>{t('sessionInfo.copyMetadata')}</MenuItemText>
                    </DropdownMenuItem>
                )}
            </DropdownMenu.Items>
            <DropdownMenu.Trigger>{children}</DropdownMenu.Trigger>
        </DropdownMenu>
    );
}
