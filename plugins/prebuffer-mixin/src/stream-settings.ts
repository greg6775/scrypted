import { getH264DecoderArgs } from "@scrypted/common/src/ffmpeg-hardware-acceleration";
import { StorageSetting, StorageSettings } from "@scrypted/common/src/settings";
import { MixinDeviceBase, ResponseMediaStreamOptions, VideoCamera } from "@scrypted/sdk";
import { getTranscodeMixinProviderId } from "./transcode-settings";


export function getDefaultPrebufferedStreams(msos: ResponseMediaStreamOptions[]) {
    if (!msos)
        return;

    // do not enable rebroadcast on cloud streams or rawvideo by default.
    const firstNonCloudStream = msos.find(mso => mso.source !== 'cloud' && mso.container !== 'rawvideo');
    return firstNonCloudStream ? [firstNonCloudStream] : [];
}

export function getPrebufferedStreams(storageSettings: StorageSettings<'enabledStreams'>, msos: ResponseMediaStreamOptions[]) {
    if (!msos)
        return;

    if (!storageSettings.hasValue.enabledStreams)
        return getDefaultPrebufferedStreams(msos);

    return msos.filter(mso => storageSettings.values.enabledStreams.includes(mso.name));
}

export type StreamStorageSetting = StorageSetting & {
    prefersPrebuffer: boolean,
    preferredResolution: number,
};
export type StreamStorageSettingsDict<T extends string> = { [key in T]: StreamStorageSetting };


function getStreamTypes<T extends string>(storageSettings: StreamStorageSettingsDict<T>) {
    return storageSettings;
}

function pickBestStream(msos: ResponseMediaStreamOptions[], resolution: number) {
    if (!msos)
        return;

    let best: ResponseMediaStreamOptions;
    let bestScore: number;
    for (const mso of msos) {
        const score = Math.abs(mso.video?.width * mso.video?.height - resolution);
        if (!best || score < bestScore) {
            best = mso;
            bestScore = score;
            if (Number.isNaN(bestScore))
                bestScore = Number.MAX_SAFE_INTEGER;
        }
    }

    return best;
}

export function createStreamSettings(device: MixinDeviceBase<VideoCamera>) {
    const streamTypes = getStreamTypes({
        defaultStream: {
            title: 'Local Stream',
            description: 'The media stream to use when streaming on your local network. This stream should be prebuffered. Recommended resolution: 1920x1080 to 4K.',
            hide: true,
            prefersPrebuffer: true,
            preferredResolution: 3840 * 2160,
        },
        remoteStream: {
            title: 'Remote (Medium Resolution) Stream',
            description: 'The media stream to use when streaming from outside your local network. Selecting a low birate stream is recommended. Recommended resolution: 1270x720.',
            hide: true,
            prefersPrebuffer: false,
            preferredResolution: 1280 * 720,
        },
        lowResolutionStream: {
            title: 'Low Resolution Stream',
            description: 'The media stream to use for low resolution output, such as Apple Watch and Video Analysis. Recommended resolution: 480x360.',
            hide: true,
            prefersPrebuffer: false,
            preferredResolution: 480 * 360,
        },
        recordingStream: {
            title: 'Local Recording Stream',
            description: 'The media stream to use when recording to local storage such as an NVR. This stream should be prebuffered. Recommended resolution: 1920x1080 to 4K.',
            hide: true,
            prefersPrebuffer: true,
            preferredResolution: 3840 * 2160,
        },
        remoteRecordingStream: {
            title: 'Remote Recording Stream',
            description: 'The media stream to use when recording to cloud storage such as HomeKit Secure Video clips in iCloud. This stream should be prebuffered. Recommended resolution: 1270x720.',
            hide: true,
            prefersPrebuffer: true,
            preferredResolution: 1280 * 720,
        },
    });

    const storageSettings = new StorageSettings(device, {
        enabledStreams: {
            title: 'Prebuffered Streams',
            description: 'Prebuffering maintains an active connection to the stream and improves load times. Prebuffer also retains the recent video for capturing motion events with HomeKit Secure video. Enabling Prebuffer is not recommended on Cloud cameras.',
            multiple: true,
            hide: false,
        },
        ...streamTypes,
        transcodeStreams: {
            group: 'Transcoding',
            title: 'Transcode Streams',
            description: 'The media streams to transcode. Transcoding audio and video is not recommended and should only be used when necessary. The Rebroadcast Plugin manages the system-wide Transcode settings. See the Rebroadcast Readme for optimal configuration.',
            multiple: true,
            choices: Object.values(streamTypes).map(st => st.title),
            hide: true,
        },
        // 3/6/2022
        // Ran into an issue where the RTSP source had SPS/PPS in the SDP,
        // and none in the bitstream. Codec copy will not add SPS/PPS before IDR frames
        // unless this flag is used.
        // 3/7/2022
        // This flag was enabled by default, but I believe this is causing issues with some users.
        // Make it a setting.
        missingCodecParameters: {
            group: 'Transcoding',
            title: 'Add H264 Extra Data',
            description: 'Some cameras do not include H264 extra data in the stream and this causes live streaming to always fail (but recordings may be working). This is a inexpensive video filter and does not perform a transcode. Enable this setting only as necessary.',
            type: 'boolean',
            hide: true,
        },
        videoDecoderArguments: {
            group: 'Transcoding',
            title: 'Video Decoder Arguments',
            description: 'FFmpeg arguments used to decode input video when transcoding a stream.',
            placeholder: '-hwaccel auto',
            choices: Object.keys(getH264DecoderArgs()),
            combobox: true,
            mapPut: (oldValue, newValue) => getH264DecoderArgs()[newValue]?.join(' ') || newValue,
            hide: true,
        }
    });

    function getDefaultMediaStream(v: StreamStorageSetting, msos: ResponseMediaStreamOptions[]) {
        const enabledStreams = getPrebufferedStreams(storageSettings, msos);
        const prebufferPreferenceStreams = v.prefersPrebuffer && enabledStreams?.length > 0 ? enabledStreams : msos;
        return pickBestStream(prebufferPreferenceStreams, v.preferredResolution);
    }

    function getMediaStream(key: string, msos: ResponseMediaStreamOptions[]) {
        const v: StreamStorageSetting = storageSettings.settings[key];
        const value = storageSettings.values[key];
        let isDefault = value === 'Default';
        let stream = msos?.find(mso => mso.name === value);
        if (isDefault || !stream) {
            isDefault = true;
            stream = getDefaultMediaStream(v, msos);
        }
        return {
            title: streamTypes[key].title,
            isDefault,
            stream,
        };
    };

    function createStreamOptions(v: StreamStorageSetting, msos: ResponseMediaStreamOptions[]) {
        const choices = [
            'Default',
            ...msos.map(mso => mso.name),
        ];
        const defaultValue = getDefaultMediaStream(v, msos).name;

        const streamOptions = {
            defaultValue: 'Default',
            description: v.description + ` The default for this stream is ${defaultValue}.`,
            choices,
            hide: false,
        };
        return streamOptions;
    }

    storageSettings.options = {
        onGet: async () => {
            let enabledStreams: StorageSetting;

            const hideTranscode = device.mixins?.includes(getTranscodeMixinProviderId()) ? {
                hide: false,
            } : {};
            const hideTranscodes = {
                transcodeStreams: hideTranscode,
                missingCodecParameters: hideTranscode,
                videoDecoderArguments: hideTranscode,
            };

            try {
                const msos = await device.mixinDevice.getVideoStreamOptions();

                enabledStreams = {
                    defaultValue: getDefaultPrebufferedStreams(msos)?.map(mso => mso.name),
                    choices: msos.map(mso => mso.name),
                    hide: false,
                };

                if (msos?.length > 1) {
                    return {
                        enabledStreams,
                        defaultStream: createStreamOptions(streamTypes.defaultStream, msos),
                        remoteStream: createStreamOptions(streamTypes.remoteStream, msos),
                        lowResolutionStream: createStreamOptions(streamTypes.lowResolutionStream, msos),
                        recordingStream: createStreamOptions(streamTypes.recordingStream, msos),
                        remoteRecordingStream: createStreamOptions(streamTypes.remoteRecordingStream, msos),
                        ...hideTranscodes,
                    }
                }
                else {
                    return {
                        enabledStreams,
                        ...hideTranscodes,
                    }
                }
            }
            catch (e) {
                device.console.error('error retrieving getVideoStreamOptions', e);
            }

            return {
                ...hideTranscodes,
            }
        }
    }

    return {
        getDefaultStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.defaultStream, msos),
        getRemoteStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.remoteStream, msos),
        getLowResolutionStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.lowResolutionStream, msos),
        getRecordingStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.recordingStream, msos),
        getRemoteRecordingStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.remoteRecordingStream, msos),
        storageSettings,
    };
}
