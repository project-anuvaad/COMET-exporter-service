const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');

const { 
    storageService,
    translationExportService,
} = require('../services');

const queues = require('../constants').queues;
const utils = require('../utils');
const subtitlesUtils = require('../subtitles');
const converter = require('../converter');
const async = require('async');


const onGenerateVideoSubtitles = channel => msg => {
    const { id, videoUrl, dir, langCode, langName, title, subtitles, slides } = JSON.parse(msg.content.toString());
    console.log('got request to burn subtitles and sign language', id)
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    const subtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.srt`);
    const assSubtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.ass`);
    let videoPath;
    videoPath = path.join(tmpDirPath, `video-${uuid()}.${videoUrl.split('.').pop()}`);
    const allSubslides = [];
    fs.mkdirSync(tmpDirPath);
    utils.downloadFile(videoUrl, videoPath)
    .then(() => {
        // Generate srt subtitles
        return subtitlesUtils.generateSubtitles(subtitles, subtitlePath)
    })
    // Upload subtitles
    .then((subtitlePath) => {
        return new Promise((resolve, reject) => {
            const subtitleName = `${dir || uuid()}/${langCode ||langName}_${title}-subtitlesUtils.srt`;
            storageService.saveFile('subtitles', subtitleName, fs.createReadStream(subtitlePath))
                .then((uploadRes) => {
                    updateTranslationExportSubtitleFinish(channel, { id, url: uploadRes.url })
                    return resolve()
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
            const videoName = `${dir || uuid()}/${langCode ||langName}_${title}-with-subtitlesUtils.${videoPath.split('.').pop()}`;
            storageService.saveFile('subtitled_videos', videoName, fs.createReadStream(subtitledVideoPath))
                .then((uploadRes) => {
                    // return translationExportService.updateById(id, { subtitledVideoUrl: uploadRes.url, subtitledVideoProgress: 100, subtitledSignlanguageVideoProgress: 50 });
                    updateTranslationExportSubtitledVideoFinish(channel, { id, url: uploadRes.url });
                    return resolve(subtitledVideoPath);
                })
                .catch((err) => {
                    // If that fails that's fine, proceed to videos
                    console.log('error uploading subtitle audios', err);
                    return reject();
                })
        })
    })
    // Download picInPic videos
    .then((subtitledVideoPath) => {
        return new Promise((resolve, reject) => {
            slides.sort((a, b) => a.positon - b.position).forEach(slide => {
                slide.content.sort((a, b) => a.position - b.position).forEach((subslide) => {
                    allSubslides.push({ ...subslide, slidePosition: slide.position });
                })
            });
            // 
            const downloadFuncArray = [];
            allSubslides.filter(s => s.picInPicVideoUrl).forEach((subslide) => {
                downloadFuncArray.push((cb) => {
                    const picInPicPath = path.join(tmpDirPath, `single-picinpic-${uuid()}-${subslide.slidePosition}-${subslide.position}.${subslide.picInPicVideoUrl.split('.').pop()}`);
                    utils.downloadFile(subslide.picInPicVideoUrl, picInPicPath)
                    .then((picInPicPath) => {
                        subslide.picInPicPath = picInPicPath;
                        return cb()
                    })
                    .catch(cb)
                })
            })
            async.parallelLimit(downloadFuncArray, 2, (err) => {
                if (err) return reject(err);
                return resolve({ subtitledVideoPath, allSubslides })
            })
        })
    })
    .then(({ subtitledVideoPath, allSubslides }) => {
        return new Promise((resolve, reject) => {
            const targetPath = path.join(tmpDirPath, `overlayedvideo-${uuid()}.${subtitledVideoPath.split('.').pop()}`);
            converter.overlayVideosOnVideo(allSubslides.filter(s => s.picInPicPath).map((s) => ({ ...s, path: s.picInPicPath })), subtitledVideoPath, targetPath)
            .then(resolve)
            .catch(reject)
        })
    })
    .then((finalVideoPath) => {
        console.log('final path after overlaying', finalVideoPath);
        return storageService.saveFile('translationExports', `${dir}/${langCode ||langName}_${title}_subtitled_with_signLanguage.${finalVideoPath.split('.').pop()}`, fs.createReadStream(finalVideoPath)); 
    })
    .then(uploadRes => {
        utils.cleanupDir(tmpDirPath);
        channel.ack(msg);
        channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH, new Buffer(JSON.stringify({ id, url: uploadRes.url })), { persistent: true });
    })
    .catch(err => {
        utils.cleanupDir(tmpDirPath)
        console.log(err, ' error from catch');
        channel.ack(msg);
        channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH, new Buffer(JSON.stringify({ id })), { persistent: true });
        translationExportService.updateById(id, { subtitledSignlanguageVideoProgress: 0 }).then(() => { });
    })
}

function updateTranslationExportSubtitleFinish(channel, params) {
    channel.sendToQueue(queues.GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify(params)), { persistent: true });
}

function updateTranslationExportSubtitledVideoProgress(channel, id, progress) {
    channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_PROGRESS, new Buffer(JSON.stringify({ id, progress })), { persistent: true });
}

function updateTranslationExportSubtitledVideoFinish(channel, params) {
    channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify(params)), { persistent: true });
}

module.exports = onGenerateVideoSubtitles;