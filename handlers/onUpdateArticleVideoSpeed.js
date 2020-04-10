const fs = require('fs');
const async = require('async');
const uuid = require('uuid').v4;
const path = require('path');

const utils = require('../utils');
const converter = require('../converter');

const {
    storageService,
    articleService,
} = require('../services');

const onUpdateArticleVideoSpeed = channel => (msg) => {
    const { articleId, videoSpeed } = JSON.parse(msg.content.toString());
    let tmpFiles = [];
    let video;
    let article;
    let originalArticle;
    let videoPath;
    let speedDifference;
    const tmpDirPath = path.join(__dirname, `../tmp/${uuid()}`);
    fs.mkdirSync(tmpDirPath)
    let subslides;
    // download original video
    // cut it using the timing provided by the user
    // cut silent parts and add them as slides
    // uploaded cutted parts
    // cleanup
    // channel.ack(msg);
    console.log('=========== onUpdateArticleVideoSpeed ====================', articleId, videoSpeed)
    articleService.findById(articleId)
        .populate('originalArticle')
        .populate('video')
        // Download media
        .then(articleDoc => {
            if (!articleDoc) throw new Error('Invalid article id');
            article = articleDoc.toObject();
            originalArticle = article.originalArticle;
            speedDifference = videoSpeed - 1;
            // Use original article to get fresh media
            subslides = originalArticle.slides.slice()
                .reduce((acc, s) => s.content && s.content.length > 0 ? acc.concat(s.content.map((ss) => ({ ...ss, slidePosition: s.position, subslidePosition: ss.position }))) : acc, []).sort((a, b) => a.startTime - b.startTime);

            videoPath = path.join(tmpDirPath, `original-video-${uuid()}.${utils.getFileExtension(article.video.url)}`);
            return utils.downloadFile(article.video.url, videoPath)
        })
        // Cut video to slides
        .then(() => converter.cutSubslidesIntoVideos(subslides, videoPath))
        // Change start/end timings
        .then((subslides) => {
            // console.log('speed difference', speedDifference, subslides)
            let prevSubslide;
            subslides.forEach((subslide, index) => {
                // Background music subslides are kept unchanged
                if (subslide.speakerProfile && subslide.speakerProfile.speakerNumber === -1) {
                    const duration = subslide.endTime - subslide.startTime;
                    if (prevSubslide) {
                        subslide.startTime = prevSubslide.endTime;
                    }
                    subslide.endTime = subslide.startTime + duration;
                } else {
                    let duration = subslide.endTime - subslide.startTime;
                    if (prevSubslide) {
                        subslide.startTime = prevSubslide.endTime;
                    }
                    const durationDifference = (-speedDifference * duration)
                    if (speedDifference < 0) {
                        let newDuration = duration + durationDifference;

                        subslide.endTime = subslide.startTime + newDuration;
                    } else {
                        // Handle shrinking video
                        let newDuration = duration - durationDifference;
                        subslide.endTime = subslide.startTime + newDuration;
                    }
                    subslide.media[0].duration = subslide.endTime - subslide.startTime;
                }
                prevSubslide = subslide;
            });
            return Promise.resolve(subslides)
        })
        // apply scaling
        .then((videofiedSubslides) => {
            return new Promise((resolve, reject) => {

                // if the speed difference is +ve, then increase speed
                // if is -ve, then decrease speed
                // Speed factor is < 1 to speedup the video, and > 1 to slowdown the video
                const speedVideoFuncArray = [];
                videofiedSubslides.forEach((subslide) => {
                    if (subslide.speakerProfile && subslide.speakerProfile.speakerNumber === -1) return;
                    speedVideoFuncArray.push((cb) => {
                        const outPath = path.join(tmpDirPath, `speeded-video-${uuid()}.${utils.getFileExtension(subslide.video)}`);
                        converter.speedVideo(subslide.video, outPath, videoSpeed)
                            .then(() => {
                                subslide.video = outPath;
                                cb();
                            })
                            .catch(err => cb(err));
                    })
                })
                async.parallelLimit(speedVideoFuncArray, 1, (err) => {
                    if (err) return reject(err);
                    return resolve(videofiedSubslides);
                })
            })
        })
        .then((subslides) => {
            console.log('merging video');
            return new Promise((resolve, reject) => {
                converter.combineVideos(subslides.sort((a, b) => a.startTime - b.startTime).map((s) => ({ fileName: s.video })), {
                    onProgress: prog => console.log(prog),
                    onEnd: (err, videoPath) => {
                        if (err) return reject(err);
                        return resolve({ subslides, videoPath })
                    }
                })
            })
        })
        .then(({ subslides, videoPath }) => {
            return new Promise((resolve, reject) => {
                // Upload speeded video
                // Upload Subslides content
                const uploadFuncArray = [];
                subslides.forEach((subslide) => {
                    uploadFuncArray.push((cb) => {
                        const videoName = subslide.video.split('/').pop();
                        storageService.saveFile('speeded_slides', videoName, fs.createReadStream(subslide.video))
                            .then((res) => {
                                subslide.media[0].url = res.url;
                                subslide.media[0].mediaKey = res.data.Key;
                                cb();
                            })
                            .catch(cb);
                    })
                })
                async.parallelLimit(uploadFuncArray, 2, (err) => {
                    if (err) return reject(err);
                    return resolve({ subslides, videoPath });
                })
            })
        })
        .then(({ subslides, videoPath }) => {
            return new Promise((resolve, reject) => {
                const videoName = videoPath.split('/').pop();

                storageService.saveFile('speeded_videos', videoName, fs.createReadStream(videoPath))
                    .then((res) => {
                        utils.cleanupFiles([videoPath])
                        return resolve({ subslides, videoUrl: res.url, videoKey: res.data.Key });
                    })
                    .catch(reject);
            })
        })
        .then(({ subslides, videoUrl, videoKey }) => {
            // Perform database update
            /*
                Updated fields:
                1- startTime
                2- endTime
                3- media[0].duration
                4- media[0].mediaKey
                5- media[0].url
            */

            const slidesUpdate = {
                videoUrl,
                videoKey,
                videoSpeedLoading: false,
                videoSpeed
            };

            subslides.forEach((subslide) => {
                const updateField = `slides.${subslide.slidePosition}.content.${subslide.subslidePosition}`
                slidesUpdate[`${updateField}.startTime`] = subslide.startTime;
                slidesUpdate[`${updateField}.endTime`] = subslide.endTime;
                slidesUpdate[`${updateField}.media.0.duration`] = subslide.endTime - subslide.startTime;
                slidesUpdate[`${updateField}.media.0.mediaKey`] = subslide.media[0].mediaKey;
                slidesUpdate[`${updateField}.media.0.url`] = subslide.media[0].url;
            })
            console.log('slide updates', slidesUpdate);
            return articleService.updateById(articleId, slidesUpdate)
        })
        .then(() => {
            console.log('done updating');
            channel.ack(msg);
            utils.cleanupDir(tmpDirPath)
        })
        .catch(err => {
            console.log(err);
            console.log('====================')
            utils.cleanupDir(tmpDirPath);
            articleService.updateById(articleId, { videoSpeedLoading: false })
                .then(() => {

                })
                .catch(err => {
                    console.log(err);
                })
            channel.ack(msg);
        })
}


module.exports = onUpdateArticleVideoSpeed;