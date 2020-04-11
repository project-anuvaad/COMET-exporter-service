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
const async = require('async');


const onGenerateVideoSubtitles = channel => msg => {
    const { translationExportId } = JSON.parse(msg.content.toString());
    console.log('got request to burn subtitles and sign language', translationExportId)
    let article;
    let signLanguageArticle;
    let subtitlesDoc;
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    const subtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.srt`);
    const assSubtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.ass`);
    let videoPath;
    const allSubslides = [];
    fs.mkdirSync(tmpDirPath);
    let translationExport;
    translationExportService.findById(translationExportId)
        .then(te => {
            translationExport = te;
            return articleService.findById(translationExport.article) 
        })
        .then(a => {
            translationExport.article = article;
            return articleService.findById(translationExport.signLanguageArticle)
        })
        .then(a => {
            translationExport.signLanguageArticle = a;
            return Promise.resolve(translationExport)
        })
        .then((translationExport) => {
            return new Promise((resolve, reject) => {
                article = translationExport.article;
                signLanguageArticle = translationExport.signLanguageArticle;
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
                        console.log('error uploading subtitle audios');
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
                        return translationExportService.updateById(translationExportId, { subtitledVideoUrl: uploadRes.url, subtitledVideoProgress: 100, subtitledSignlanguageVideoProgress: 50 });
                    })
                    .then(() => {
                        console.log('done uploading')
                        return resolve(subtitledVideoPath);
                    })
                    .catch((err) => {
                        // If that fails that's fine, proceed to videos
                        console.log('error uploading subtitle audios');
                        return reject();
                    })
            })
        })
        // Download picInPic videos
        .then((subtitledVideoPath) => {
            return new Promise((resolve, reject) => {
                signLanguageArticle.slides.sort((a, b) => a.positon - b.position).forEach(slide => {
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
            return storageService.saveFile('translationExports', `${translationExport.dir}/${article.langCode || article.langName}_${article.title}_subtitled_with_signLanguage.${finalVideoPath.split('.').pop()}`, fs.createReadStream(finalVideoPath)); 
        })
        .then(uploadRes => {
            return new Promise((resolve, reject) => {
                translationExportService.updateById(translationExportId, { subtitledSignlanguageVideoProgress: 100, subtitledSignlanguageVideoUrl: uploadRes.url })
                .then(resolve)
                .catch(reject);
            })
        })
        .then(() => {
            utils.cleanupDir(tmpDirPath);
            channel.ack(msg);
            channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
        })
        .catch(err => {
            utils.cleanupDir(tmpDirPath)
            console.log(err, ' error from catch');
            channel.ack(msg);
            channel.sendToQueue(queues.BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
            translationExportService.updateById(translationExportId, { subtitledSignlanguageVideoProgress: 0 }).then(() => { });
        })
}

module.exports = onGenerateVideoSubtitles;