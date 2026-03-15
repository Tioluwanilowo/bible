export class AudioInputManager {
  static async getDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.warn('MediaDevices API not supported in this environment.');
      return [];
    }

    try {
      // Request permission so device labels are revealed, then immediately release the stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audioinput');
    } catch (error) {
      console.error('Failed to enumerate audio devices:', error);
      return [];
    }
  }

  static async connectDevice(deviceId: string): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
      });
      return stream;
    } catch (error) {
      console.error(`Failed to connect to audio device ${deviceId}:`, error);
      return null;
    }
  }
}
