const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');

const {
    storageService,
} = require('../services');

const queues = require('../constants').queues;
const utils = require('../utils');
const subtitlesUtils = require('../subtitles');
const converter = require('../converter');


const onGenerateVideoSubtitles = channel => msg => {
    const { id, videoUrl, langCode, langName, title, dir, subtitles } = JSON.parse(msg.content.toString());
    console.log('got request to burn subtitles', id)
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    const subtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.srt`);
    const assSubtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.ass`);
    let videoPath;
    fs.mkdirSync(tmpDirPath);
    if (!videoUrl) {
        updateTranslationExportSubtitledVideoProgress(channel, id, 0)
        return channel.ack(msg); 
    }
    videoPath = path.join(tmpDirPath, `video-${uuid()}.${videoUrl.split('.').pop()}`);
        utils.downloadFile(videoUrl, videoPath)
        .then(() => {
            return subtitlesUtils.generateSubtitles(subtitles, subtitlePath)
        })
        // Upload subtitles
        .then((subtitlePath) => {
            return new Promise((resolve, reject) => {
                const subtitleName = `${dir || uuid()}/${langCode || langName}_${title}-subtitles.srt`;
                storageService.saveFile('subtitles', subtitleName, fs.createReadStream(subtitlePath))
                    .then((uploadRes) => {
                        updateTranslationExportSubtitleFinish(channel, { id, url: uploadRes.url })
                        resolve();
                    })
                    .catch((err) => {
                        // If that fails that's fine, proceed to videos
                        console.log('error uploading subtitle audios', err);
                        return reject();
                    })
            })
        })
        // Generate ass subtitle
        .then(() => {
            return subtitlesUtils.generateSubtitles(subtitles, assSubtitlePath)
        })
        // Burn generated subtitles to the video
        .then(() => {
            return new Promise((resolve, reject) => {
                const outPath = path.join(tmpDirPath, `subtitled-video-${uuid()}.${videoPath.split('.').pop()}`);
                converter.burnSubtitlesToVideo(videoPath, assSubtitlePath, outPath, {
                    onProgress: (progress) => {
                        if (progress) {
                            updateTranslationExportSubtitledVideoProgress(channel, id, progress)
                        }
                    },
                    onEnd: (err, outPath) => {
                        if (err) return reject(err);
                        return resolve(outPath);
                    }
                })
            })
        })
        // Upload Video
        .then((subtitledVideoPath) => {
            return new Promise((resolve, reject) => {
                const videoName = `${dir || uuid()}/${langCode || langName}_${title}-with-subtitles.${videoPath.split('.').pop()}`;
                storageService.saveFile('subtitled_videos', videoName, fs.createReadStream(subtitledVideoPath))
                    .then((uploadRes) => {
                        console.log('done uploading')
                        return resolve(uploadRes)
                    })
                    .catch((err) => {
                        // If that fails that's fine, proceed to videos
                        console.log('error uploading subtitle audios', err);
                        return reject();
                    })
            })
        })
        .then((uploadRes) => {
            utils.cleanupDir(tmpDirPath);
            channel.ack(msg);
            channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify({ id, url: uploadRes.url })), { persistent: true });
        })
        .catch(err => {
            utils.cleanupDir(tmpDirPath)
            console.log(err, ' error from catch');
            channel.ack(msg);
            updateTranslationExportSubtitledVideoProgress(channel, id, 0)
        })
}

function updateTranslationExportSubtitleFinish(channel, params) {
    channel.sendToQueue(queues.GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify(params)), { persistent: true });
}

function updateTranslationExportSubtitledVideoProgress(channel, id, progress) {
    channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_PROGRESS, new Buffer(JSON.stringify({ id, progress })), { persistent: true });
}


module.exports = onGenerateVideoSubtitles;