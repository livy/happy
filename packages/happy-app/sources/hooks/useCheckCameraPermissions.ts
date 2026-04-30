import { useCameraPermissions } from "expo-camera";

export function useCheckScannerPermissions(): () => Promise<boolean> {
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();

    return async () => {
        if (!cameraPermission) {
            const reqRes = await requestCameraPermission();
            return reqRes.granted;
        }

        if (!cameraPermission.granted) {
            const reqRes = await requestCameraPermission();
            return reqRes.granted;
        }

        return true;
    }
}
