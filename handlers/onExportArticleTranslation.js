const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');

const {
    translationExportService,
    storageService,
    videoService,
    articleService,
} = require('../services');

const async = require('async');
const queues = require('../constants').queues;
const utils = require('../utils');
const converter = require('../converter');

const DEFAULT_AUDIO_FADE = { fadeDuration: 20, durationType: 'percentage' };

const onExportArticleTranslation = channel => msg => {
    const { translationExportId } = JSON.parse(msg.content.toString());
    console.log('got request to export', translationExportId)
    // const tmpFiles = [];
    let article;
    let allSubslides = [];
    // let finalSubslides = [];
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../${tmpDirName}`);
    let originalVideoPath = '';
    let finalAudioPath = '';
    fs.mkdirSync(tmpDirPath);
    let video;
    let translationExport;
    let finalVideoPath = '';
    let uploadedVideoUrl = '';
    let compressedVideoUrl = '';

    translationExportService.findById(translationExportId)
        .then((te) => {
            if (!te) {
                throw new Error('Invalid translation export id')
            }
            translationExport = te;
            return articleService.findById(te.article)
        })
        .then(a => {
            translationExport.article = a;
            return videoService.findById(translationExport.video)
        })
        .then(v => {
            translationExport.video = v;
            return Promise.resolve(translationExport)
        })
        .then(() => {
            return new Promise((resolve, reject) => {
                // console.log('found article', a)
                article = translationExport.article;
                video = translationExport.video;
                originalVideoPath = path.join(tmpDirPath, `original-video-${uuid()}.${video.url.split('.').pop()}`)
                article.slides.sort((a, b) => a.positon - b.position).forEach(slide => {
                    slide.content.sort((a, b) => a.position - b.position).forEach((subslide) => {
                        allSubslides.push({ ...subslide, slidePosition: slide.position });
                    })
                });
                // Update status to processing
                translationExportService.updateById(translationExportId, { status: 'processing' }).then(() => {
                })
                .catch(err => { console.log(err) });

                allSubslides = allSubslides.sort((a, b) => a.startTime - b.startTime).map((s,index) => ({ ...s, position: index }));
                // allSubslides
                const downloadMediaFuncArray = [];

                console.log('downloading media')
                downloadMediaFuncArray.push((cb) => {
                    console.log('Downloading original video');
                    const videoUrl = video.url;
                    utils.downloadFile(videoUrl, originalVideoPath)
                    .then(() => {
                        return cb();
                    })
                    .catch(cb);
                })

                allSubslides.forEach((subslide) => {
                    downloadMediaFuncArray.push((cb) => {
                        // if it's not a sign lang article, download audio
                        // otherwise download picInPicVideoUrl
                        if (!article.signLang) {
                            const audioPath = path.join(__dirname, `../${tmpDirName}`, `single-audio-${uuid()}-${subslide.slidePosition}-${subslide.position}.${subslide.audio.split('.').pop()}`);
                            utils.downloadFile( translationExport.cancelNoise && subslide.processedAudio ? subslide.processedAudio : subslide.audio, audioPath)
                            .then((audioPath) => {
                                subslide.audioPath = audioPath;
                                return cb()
                            })
                            .catch(cb)
                        } else if (subslide.picInPicVideoUrl) {
                            const picInPicPath = path.join(__dirname, `../${tmpDirName}`, `single-picinpic-${uuid()}-${subslide.slidePosition}-${subslide.position}.${subslide.picInPicVideoUrl.split('.').pop()}`);
                            utils.downloadFile(subslide.picInPicVideoUrl, picInPicPath)
                            .then((picInPicPath) => {
                                subslide.picInPicPath = picInPicPath;
                                return cb()
                            })
                            .catch(cb)
                        } else {
                            setTimeout(() => {
                                return cb();
                            }, 100);
                        }
                    })
                })

                async.parallelLimit(downloadMediaFuncArray, 2, (err) => {
                    if (err) return reject(err);
                    return resolve(allSubslides);
                })
            })
        })
        .then(allSubslides => {
            return new Promise((resolve, reject) => {
                // Skip convrint audio for signLang
                if (article.signLang) return resolve(allSubslides);

                const addAudioFuncArray = [];
                allSubslides.forEach((subslide) => {
                    if (subslide.audioPath) {
                        addAudioFuncArray.push((cb) => {
                            // Convert any extension to mp3
                            const audioExt = subslide.audioPath.split('.').pop().toLowerCase();
                            if ( audioExt !== 'mp3') {
                                console.log('converting to mp3')
                                converter.convertToMp3(subslide.audioPath)
                                .then((newPath) => {
                                    subslide.audioPath = newPath;
                                    return cb();
                                })
                                .catch((err) => {
                                    return cb(err);  
                                })
                            } else {
                                return cb()
                            }
                        })
                    }
                })
                async.parallelLimit(addAudioFuncArray, 1, (err) => {
                    if (err) return reject(err);
                    return resolve(allSubslides);
                })
            })
        })
        // increase volume of recorded audios
        .then((allSubslides) => {
            return new Promise((resolve) => {
                if (article.signLang) return resolve(allSubslides);
                // Increase volume
                if (!translationExport.voiceVolume || translationExport.voiceVolume === 1) return resolve(allSubslides);
                const increaseVolumeFuncArray = [];
                allSubslides.forEach((subslide) => {
                    if (subslide.speakerProfile && subslide.speakerProfile.speakerNumber !== -1) {
                        increaseVolumeFuncArray.push(cb => {
                            const targetPath = path.join(__dirname, `../${tmpDirName}`, `increaseVolume-audio-${uuid()}.${subslide.audioPath.split('.').pop()}`);
                            converter.changeAudioVolume(subslide.audioPath, targetPath, translationExport.voiceVolume)
                            .then((outPath) => {
                                console.log('increase volume to ', translationExport.voiceVolume)
                                subslide.audioPath = outPath;
                                cb();
                            })
                            .catch(err => {
                                console.log('error changing audio volume', err);
                                cb();
                            })
                        })

                    }
                })

                async.series(increaseVolumeFuncArray, (err) => {
                    if (err) {
                        console.log(err);
                    }
                    return resolve(allSubslides)
                })
            })
        })
        // Fade in/out effects on audios
        .then((allSubslides) => {
            return new Promise((resolve) => {
                allSubslides = allSubslides.sort((a, b) => a.startTime - b.startTime);
                if (article.signLang) return resolve(allSubslides);

                const firstTranslationSlideIndex = allSubslides.findIndex((s) => s.speakerProfile.speakerNumber !== -1);
                const lastTranslationSlideIndex = (allSubslides.length - 1) - allSubslides.slice().reverse().findIndex((s) => s.speakerProfile.speakerNumber !== -1);
                let backgroundMusicSlidesIndexes  = [];
                allSubslides.forEach((s, index) => {
                    if (s.speakerProfile && s.speakerProfile.speakerNumber === -1) {
                        backgroundMusicSlidesIndexes.push(index);
                    }
                })
                const fadevideoFuncArray = [];

                /* Temporarly disable fading in first translation slide and 
                    fading out last translations slide
                */
                /*
                // First translation slide
                fadevideoFuncArray.push((cb) => {
                    const firstSubslide = allSubslides[firstTranslationSlideIndex];
                    const newaudioPath = path.join(__dirname, `../${tmpDirName}`, `faded-video-${uuid()}.${firstSubslide.audioPath.split('.').pop()}`);
                    converter.fadeAudio(allSubslides[firstTranslationSlideIndex].audioPath, 'in', DEFAULT_AUDIO_FADE, newaudioPath)
                    .then(() => {
                        allSubslides[firstTranslationSlideIndex].audioPath = newaudioPath;
                        return cb();
                    })
                    .catch((err) => {
                        console.log(err);
                        return cb();
                    })
                })
                // Fade out last translation slide
                fadevideoFuncArray.push((cb) => {
                    const lastSubslide = allSubslides[lastTranslationSlideIndex];
                    const newaudioPath = path.join(__dirname, `../${tmpDirName}`, `faded-audio-${uuid()}.${lastSubslide.audioPath.split('.').pop()}`);
                    converter.fadeAudio(allSubslides[lastTranslationSlideIndex].audioPath, 'out', DEFAULT_AUDIO_FADE, newaudioPath)
                    .then(() => {
                        allSubslides[lastTranslationSlideIndex].audioPath = newaudioPath;
                        return cb();
                    })
                    .catch((err) => {
                        console.log(err);
                        return cb();
                    })
                })
                */
                // Fade in all background music slides
                if (!video.backgroundMusicUrl) {
                    backgroundMusicSlidesIndexes.forEach((subslideIndex) => {
                        fadevideoFuncArray.push((cb) => {
                            const subslide = allSubslides[subslideIndex];
                            const newaudioPath = path.join(__dirname, `../${tmpDirName}`, `faded-audio-${uuid()}.${subslide.audioPath.split('.').pop()}`);
                            converter.fadeAudio(allSubslides[subslideIndex].audioPath, 'both', DEFAULT_AUDIO_FADE, newaudioPath)
                            .then((audioPath) => {
                                allSubslides[subslideIndex].audioPath = audioPath;
                                // Fade in the following subslide if it exists
                                if (subslideIndex + 1 !== firstTranslationSlideIndex &&
                                    subslideIndex + 1 !== lastTranslationSlideIndex && 
                                    allSubslides[subslideIndex + 1] &&
                                    allSubslides[subslideIndex + 1].speakerProfile &&
                                    allSubslides[subslideIndex + 1].speakerProfile.speakerNumber !== -1
                                    ) {
                                        const nextSubslide = allSubslides[subslideIndex + 1];
                                        const newNextaudioPath = path.join(__dirname, `../${tmpDirName}`, `faded-audio-${uuid()}.${nextSubslide.audioPath.split('.').pop()}`);
                                        converter.fadeAudio(nextSubslide.audioPath, 'in', DEFAULT_AUDIO_FADE, newNextaudioPath)
                                        .then((audioPath) => {
                                            allSubslides[subslideIndex + 1].audioPath = audioPath;
                                            return cb();
                                        })
                                        .catch(err => {
                                            console.log(err);
                                            return cb()
                                        })
                                    } else {
                                        return cb();
                                    }
                            })
                            .catch((err) => {
                                console.log(err);
                                return cb();
                            })
                        })
                    })
                }

                async.series(fadevideoFuncArray, (err) => {
                    if (err) {
                        console.log('error applying fade ', err);
                    }

                    return resolve(allSubslides)
                })
            })
        })
        // Extend audios to videos durations and combine into one file
        .then(allSubslides => {
            return new Promise((resolve, reject) => {
                if (article.signLang) return resolve(allSubslides);
                const extendAudiosFuncArray = [];
                allSubslides.forEach((subslide) => {
                    extendAudiosFuncArray.push(cb => {
                        const targetPath = path.join(tmpDirPath, `extended-audio-${uuid()}.${subslide.audioPath.split('.').pop()}`);
                        converter.extendAudioDuration(subslide.audioPath, targetPath, parseFloat(subslide.endTime - subslide.startTime).toFixed(3))
                        .then((newPath) => {
                            subslide.audioPath = newPath;
                            cb();
                        })
                        .catch(cb);
                    })
                })

                async.parallelLimit(extendAudiosFuncArray, 2, (err) => {
                    if (err) return reject(err);
                    return resolve(allSubslides);
                })
            })
        })
        // Convert background music slides to silent audios if the video already have backgroundMusicUrl
        .then((allSubslides) => {
            return new Promise((resolve) => {
                if (!video.backgroundMusicUrl) return resolve(allSubslides);
                if (article.signLang) return resolve(allSubslides);

                const generateSilentAudioFuncArray = [];
                allSubslides.filter((s) => s.speakerProfile && s.speakerProfile.speakerNumber === -1).forEach((subslide) => {
                    generateSilentAudioFuncArray.push((cb) => {
                        const newaudioPath = path.join(__dirname, `../${tmpDirName}`, `silent-audio-${uuid()}.${subslide.audioPath.split('.').pop()}`);
                   
                        converter.generateSilentFile(newaudioPath, subslide.endTime - subslide.startTime)
                        .then(() => {
                            subslide.audioPath = newaudioPath;
                            return cb();
                        })
                        .catch(err => {
                            console.log('error generating silent file', err);
                            return cb();
                        })
                    })
                })
                async.series(generateSilentAudioFuncArray, () => {
                    resolve(allSubslides);
                })
            })
        })
        // Concat audios
        .then((subslides) => {
            allSubslides = subslides;
            return new Promise((resolve, reject) => {
                if (article.signLang) {
                    // extract original audio and forward it
                    const originalAudioPath = path.join(tmpDirPath, `original-audio-${uuid()}.mp3`)
                    converter.extractAudioFromVideo(originalVideoPath, originalAudioPath)
                    .then(() => resolve(originalAudioPath))
                    .catch(reject);
                } else {
                    const finalAudioPath = path.join(tmpDirPath, `final-audio-${uuid()}.${allSubslides[0].audioPath.split('.').pop()}`);
                    converter.combineAudios(allSubslides.map((s) => s.audioPath), finalAudioPath)
                    .then(() => {
                        return resolve(finalAudioPath);
                    })
                    .catch(reject);
                }
            })
        })
        // Normalize audio step
        .then((finalAudioPath) => {
            return new Promise((resolve) => {
                if (!translationExport.normalizeAudio) return resolve(finalAudioPath);
                const normalizedFinalAudioPath = path.join(tmpDirPath, `normalized-final-audio-${uuid()}.${finalAudioPath.split('.').pop()}`);
                converter.normalizeAudio(finalAudioPath, normalizedFinalAudioPath)
                .then(() => {
                    return resolve(normalizedFinalAudioPath);
                })
                .catch(err => {
                    console.log('error normalizing audio', err);
                    return resolve(finalAudioPath);
                })
            })
        })
        // if any slide has different video speed, adjust the speed in the original video
        .then((faudioPath) => {
            finalAudioPath = faudioPath;
            return new Promise((resolve) => {
                if (allSubslides.some(s => s.videoSpeed && s.videoSpeed !== 1 && s.speakerProfile && s.speakerProfile.speakerNumber !== -1)) {
                    const adjustVidepSpeedFuncArray = [];
                    allSubslides.filter(s => s.videoSpeed && s.videoSpeed !== 1 && s.speakerProfile && s.speakerProfile.speakerNumber !== -1).forEach(subslide => {
                        adjustVidepSpeedFuncArray.push(cb => {
                            console.log('changing speed of ', subslide.slidePosition, subslide.position)
                            let videoPath = path.join(tmpDirPath, `slowed_video_${uuid()}.${originalVideoPath.split('.').pop()}` )
                            converter.speedVideoPart(originalVideoPath, videoPath, subslide.videoSpeed, subslide.startTime, subslide.endTime)
                            .then(() => {
                                originalVideoPath = videoPath;
                                cb();
                            })
                            .catch(err => {
                                console.log('error adjusting speed of ', subslide, err);
                                cb();
                            })
                        })
                    })
                    async.series(adjustVidepSpeedFuncArray, (err) => {
                        if (err) {
                            console.log(err);
                        }
                        return resolve(finalAudioPath);
                    })
                } else {
                    return resolve(finalAudioPath);
                }
            })
        })
        // Overlay audio on video
        .then((finalAudioPath) => {
            const finalVideoPath = path.join(tmpDirPath, `final-video-${uuid()}.${video.url.split('.').pop()}`)
            return converter.addAudioToVideo(originalVideoPath, finalAudioPath, finalVideoPath)
        })
        .then((finalVideoPath) => {
            // Overlay background music if it exists
            return new Promise((resolve) => {
                if (!video.backgroundMusicUrl) return resolve(finalVideoPath);
                const overlayedFinalVideoPath = path.join(__dirname, `../${tmpDirName}`, `overlayed-video-${uuid()}.${finalVideoPath.split('.').pop()}`);
                const backgroundMusicPath = path.join(__dirname, `../${tmpDirName}`, `background-music-${uuid()}.${video.backgroundMusicUrl.split('.').pop()}`);
                utils.downloadFile(video.backgroundMusicUrl, backgroundMusicPath)
                .then(() => {
                    return converter.overlayAudioOnVideo(finalVideoPath, backgroundMusicPath, translationExport.backgroundMusicVolume || 1, overlayedFinalVideoPath)
                })
                .then(() => {
                    return resolve(overlayedFinalVideoPath);
                })
                .catch((err) => {
                    console.log('error overlaying background music', err);
                    return resolve(finalVideoPath);
                })
            })
        })
        .then(finalVideoPath => {
            return new Promise((resolve, reject) => {
                if (!article.signLang) {
                    return resolve(finalVideoPath);
                }
                // if its sign language, burn video sign picInPic to video slide
                const targetPath = path.join(tmpDirPath, `overlayedvideo-${uuid()}.${finalVideoPath.split('.').pop()}`);
                converter.overlayVideosOnVideo(allSubslides.filter(s => s.picInPicPath).map((s) => ({ ...s, path: s.picInPicPath })), finalVideoPath, targetPath)
                .then(resolve)
                .catch(reject)
            })
        })
        .then((vidPath) => {
            finalVideoPath = vidPath;
            console.log('final path', finalVideoPath);
            return storageService.saveFile('translationExports', `${translationExport.dir}/${article.langCode || article.langName}_${article.title}.${finalVideoPath.split('.').pop()}`, fs.createReadStream(finalVideoPath)); 
        })
        .then(uploadRes => {
            uploadedVideoUrl = uploadRes.url;
            const targetPath = path.join(tmpDirPath, `compressed_video-${uuid()}.${finalVideoPath.split('.').pop()}`);
            return converter.compressVideo(finalVideoPath, targetPath)
        })
        .then((compressedVidPath) => {
            return storageService.saveFile('translationExports', `${translationExport.dir}/compressed_${article.langCode || article.langName}_${article.title}.${compressedVidPath.split('.').pop()}`, fs.createReadStream(compressedVidPath)); 
        })
        .then(uploadRes => {
            compressedVideoUrl = uploadRes.url
            return new Promise((resolve, reject) => {
                translationExportService.updateById(translationExportId, { status: 'done', progress: 100, videoUrl: uploadedVideoUrl, compressedVideoUrl: compressedVideoUrl }).then(() => {
                    channel.sendToQueue(queues.EXPORT_ARTICLE_TRANSLATION_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
                    channel.ack(msg);
                    console.log('done')
                    return resolve()
                })
                .catch(reject);
            })
        })
        .then(() => {
            utils.cleanupDir(path.join(__dirname, `../${tmpDirName}`))
        })
        .catch(err => {
            utils.cleanupDir(path.join(__dirname, `../${tmpDirName}`))
            console.log(err,' error from catch');
            channel.ack(msg);
            translationExportService.updateById(translationExportId, { status: 'failed' }).then(() => {});
            channel.sendToQueue(queues.EXPORT_ARTICLE_TRANSLATION_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
        })
}

// function updateTranslationExportProgress(translationExportId, progress) {
//     translationExportService.updateById(translationExportId, { progress })
//     .then(() => {
//         console.log('progress', progress)
//     })
//     .catch(err => {
//         console.log('error updating progres', err);
//     })
// }

module.exports = onExportArticleTranslation;