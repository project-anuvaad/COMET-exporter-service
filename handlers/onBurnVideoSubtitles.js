const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');

const {
    storageService,
    translationExportService,
    subtitlesService,
    articleService,
} = require('../services');

const queues = require('../constants').queues;
const utils = require('../utils');
const subtitles = require('../subtitles');
const converter = require('../converter');


const onGenerateVideoSubtitles = channel => msg => {
    const { translationExportId } = JSON.parse(msg.content.toString());
    console.log('got request to burn subtitles', translationExportId)
    let article;
    let subtitlesDoc;
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    const subtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.srt`);
    const assSubtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.ass`);
    let videoPath;
    fs.mkdirSync(tmpDirPath);
    let translationExport;
    translationExportService.findById(translationExportId)
        .then(te => {
            translationExport = te
            return articleService.findById(te.article)
        })
        .then(article => {
            translationExport.article = article;
            return Promise.resolve(translationExport)
        })
        .then((translationExport) => {
            return new Promise((resolve, reject) => {
                article = translationExport.article;
                console.log('downloading video');
                videoPath = path.join(tmpDirPath, `video-${uuid()}.${translationExport.videoUrl.split('.').pop()}`);
                utils.downloadFile(translationExport.videoUrl, videoPath)
                    .then(resolve)
                    .catch(reject)
            })

        })
        .then(() => subtitlesService.find({ article: article._id }))
        .then((subtitlesDocs) => {
            if (!subtitlesDocs || subtitlesDocs.length === 0) throw new Error('This translation has no generate subtitles yet');
            subtitlesDoc = subtitlesDocs[0].toObject();
            // Generate srt subtitles
            // const allSubslides = article.slides.reduce((acc, s) => acc.concat(s.content), []).filter((s) => s.text && s.text.trim()).sort((a, b) => a.startTime - b.startTime).map((s, index) => ({ ...s, position: index }));
            return subtitles.generateSubtitles(subtitlesDoc.subtitles, subtitlePath)
        })
        // Upload subtitles
        .then((subtitlePath) => {
            return new Promise((resolve, reject) => {
                const subtitleName = `${translationExport.dir || uuid()}/${article.langCode || article.langName}_${article.title}-subtitles.srt`;
                storageService.saveFile('subtitles', subtitleName, fs.createReadStream(subtitlePath))
                    .then((uploadRes) => {
                        return translationExportService.updateById(translationExportId, { subtitleUrl: uploadRes.url, subtitleProgress: 100 });
                    })
                    .then(() => {
                        console.log('done uploading')
                        return resolve();
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
            return subtitles.generateSubtitles(subtitlesDoc.subtitles, assSubtitlePath)
        })
        // Burn generated subtitles to the video
        .then(() => {
            return new Promise((resolve, reject) => {
                const outPath = path.join(tmpDirPath, `subtitled-video-${uuid()}.${videoPath.split('.').pop()}`);
                converter.burnSubtitlesToVideo(videoPath, assSubtitlePath, outPath, {
                    onProgress: (progress) => {
                        console.log('progressing burn', progress)
                        if (progress) {

                            translationExportService.update({ _id: translationExportId }, { subtitledVideoProgress: progress })
                                .then(() => {

                                })
                                .catch(err => {
                                    console.log('error updating progress', err);
                                })
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
                const videoName = `${translationExport.dir || uuid()}/${article.langCode || article.langName}_${article.title}-with-subtitles.${videoPath.split('.').pop()}`;
                storageService.saveFile('subtitled_videos', videoName, fs.createReadStream(subtitledVideoPath))
                    .then((uploadRes) => {
                        return translationExportService.updateById(translationExportId, { subtitledVideoUrl: uploadRes.url, subtitledVideoProgress: 100 });
                    })
                    .then(() => {
                        console.log('done uploading')
                        return resolve();
                    })
                    .catch((err) => {
                        // If that fails that's fine, proceed to videos
                        console.log('error uploading subtitle audios', err);
                        return reject();
                    })
            })
        })
        .then(() => {
            utils.cleanupDir(tmpDirPath);
            channel.ack(msg);
            channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
        })
        .catch(err => {
            utils.cleanupDir(tmpDirPath)
            console.log(err, ' error from catch');
            channel.ack(msg);
            translationExportService.updateById(translationExportId, { subtitledVideoProgress: 0 }).then(() => { });
        })
}

// function updateTranslationExportSubtitledVideoProgress(translationExportId, subtitleProgress) {
//     translationExportService.update({ _id: translationExportId }, { subtitleProgress })
//         .then((r) => {
//             console.log('progress', subtitleProgress)
//             translationExportService.findById(subtitleProgress)
//                 .then((exporitem) => {
//                     console.log(exporitem)
//                 })
//         })
//         .catch(err => {
//             console.log('error updating progres', err);
//         })
// }


module.exports = onGenerateVideoSubtitles;