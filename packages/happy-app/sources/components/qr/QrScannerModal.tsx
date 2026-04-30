import * as React from 'react';
import { ActivityIndicator, Dimensions, Platform, Pressable, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { RoundButton } from '@/components/RoundButton';
import { t } from '@/text';

interface QrScannerModalProps {
    expectedPrefix: string;
    title: string;
    permissionMessage: string;
    onScan: (data: string) => void | Promise<void>;
    onClose?: () => void;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const scannerWidth = Math.min(screenWidth - 32, 420);
const scannerHeight = Math.min(screenHeight - 96, 620);
const frameSize = Math.min(scannerWidth - 64, 260);

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        width: scannerWidth,
        maxWidth: '100%',
        height: scannerHeight,
        backgroundColor: theme.colors.surface,
        borderRadius: 24,
        overflow: 'hidden',
    },
    cameraContainer: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    camera: {
        flex: 1,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'space-between',
        padding: 20,
    },
    topBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    title: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        color: '#FFFFFF',
        marginRight: 12,
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    centerArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    frame: {
        width: frameSize,
        height: frameSize,
        borderWidth: 2,
        borderColor: '#FFFFFF',
        borderRadius: 24,
        backgroundColor: 'transparent',
    },
    bottomBar: {
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    helperText: {
        color: '#FFFFFF',
        textAlign: 'center',
        fontSize: 14,
        lineHeight: 20,
    },
    stateContainer: {
        flex: 1,
        padding: 24,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },
    stateText: {
        textAlign: 'center',
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.textSecondary,
    },
    buttonRow: {
        width: '100%',
        gap: 12,
    },
}));

export function QrScannerModal(props: QrScannerModalProps) {
    const styles = stylesheet;
    const [permission, requestPermission] = useCameraPermissions();
    const [cameraError, setCameraError] = React.useState<string | null>(null);
    const isProcessingRef = React.useRef(false);
    const hasRequestedPermissionRef = React.useRef(false);

    React.useEffect(() => {
        if (Platform.OS === 'web') {
            return;
        }

        if (permission && !permission.granted && permission.canAskAgain && !hasRequestedPermissionRef.current) {
            hasRequestedPermissionRef.current = true;
            requestPermission().catch((error) => {
                console.warn('Failed to request camera permission', error);
            });
        }
    }, [permission, requestPermission]);

    const handleScan = React.useCallback(async (event: { data: string }) => {
        if (isProcessingRef.current) {
            return;
        }

        if (!event.data.startsWith(props.expectedPrefix)) {
            return;
        }

        isProcessingRef.current = true;
        props.onClose?.();
        await props.onScan(event.data);
    }, [props]);

    if (!permission || permission.status === 'undetermined') {
        return (
            <View style={styles.container}>
                <View style={styles.stateContainer}>
                    <ActivityIndicator size="large" />
                    <Text style={styles.stateText}>{t('common.loading')}</Text>
                </View>
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <View style={styles.stateContainer}>
                    <Text style={styles.stateText}>{props.permissionMessage}</Text>
                    <View style={styles.buttonRow}>
                        {permission.canAskAgain && (
                            <RoundButton
                                title={t('common.retry')}
                                onPress={() => {
                                    requestPermission().catch((error) => {
                                        console.warn('Failed to retry camera permission request', error);
                                    });
                                }}
                            />
                        )}
                        <RoundButton
                            title={t('common.cancel')}
                            display="inverted"
                            onPress={props.onClose}
                        />
                    </View>
                </View>
            </View>
        );
    }

    if (cameraError) {
        return (
            <View style={styles.container}>
                <View style={styles.stateContainer}>
                    <Text style={styles.stateText}>{cameraError}</Text>
                    <View style={styles.buttonRow}>
                        <RoundButton
                            title={t('common.cancel')}
                            display="inverted"
                            onPress={props.onClose}
                        />
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.cameraContainer}>
                <CameraView
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={handleScan}
                    onMountError={(event) => {
                        setCameraError(event.message || props.permissionMessage);
                    }}
                />
                <View style={styles.overlay} pointerEvents="box-none">
                    <View style={styles.topBar}>
                        <Text style={styles.title}>{props.title}</Text>
                        <Pressable onPress={props.onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={20} color="#FFFFFF" />
                        </Pressable>
                    </View>
                    <View style={styles.centerArea} pointerEvents="none">
                        <View style={styles.frame} />
                    </View>
                    <View style={styles.bottomBar}>
                        <Text style={styles.helperText}>{t('common.scanning')}</Text>
                    </View>
                </View>
            </View>
        </View>
    );
}
