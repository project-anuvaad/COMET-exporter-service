const fs = require('fs');
const async = require('async');
const uuid = require('uuid').v4;
const path = require('path');

const utils = require('../utils');
const converter = require('../converter');

const {
    storageService,
    articleService,
    videoService,
} = require('../services');

const onUpdateArticleSlideVideoSpeed = channel => (msg) => {
    const { articleId, videoSpeed, slidePosition, subslidePosition } = JSON.parse(msg.content.toString());
    let article;
    let originalArticle;
    let videoPath;
    let speedDifference;
    const tmpDirPath = path.join(__dirname, `../tmp/${uuid()}`);
    fs.mkdirSync(tmpDirPath)
    let subslides;
    let targetSubslideIndex;
    let targetSubslide;
    let originalSubslides;
    let originalTargetSubslideIndex;
    let originalTargetSubslide;
    let originalTargetSubslideVideoPath;
    // download original video
    // cut it using the timing provided by the user
    // cut silent parts and add them as slides
    // uploaded cutted parts
    // cleanup
    // channel.ack(msg);
    console.log('=========== onUpdateArticleSlideVideoSpeed ====================', articleId, videoSpeed, slidePosition, subslidePosition)
    articleService.findById(articleId)
        .then((a) => {
            if (!a) throw new Error('Invalid article id');

            article = a;
            return articleService.findById(a.originalArticle)
        })
        .then(o => {
            article.originalArticle = o;
            return videoService.findById(article.video)
        })
        .then(v => {
            article.video = v;
            return Promise.resolve(article);
        })
        // Download media
        .then(() => {
            originalArticle = article.originalArticle;
            // if the speed difference is +ve, then increase speed
            // if is -ve, then decrease speed
            // Speed factor is < 1 to speedup the video, and > 1 to slowdown the video
            // Use original article to get fresh media
            subslides = article.slides.slice()
                .reduce((acc, s) => s.content && s.content.length > 0 ? acc.concat(s.content.map((ss) => ({ ...ss, slidePosition: s.position, subslidePosition: ss.position }))) : acc, []).sort((a, b) => a.startTime - b.startTime);
            originalSubslides = article.originalArticle.slides.slice()
                .reduce((acc, s) => s.content && s.content.length > 0 ? acc.concat(s.content.map((ss) => ({ ...ss, slidePosition: s.position, subslidePosition: ss.position }))) : acc, []).sort((a, b) => a.startTime - b.startTime);

            originalTargetSubslideIndex = originalSubslides.findIndex(s => s.slidePosition === parseInt(slidePosition) && s.subslidePosition === parseInt(subslidePosition))
            originalTargetSubslide = originalSubslides[originalTargetSubslideIndex]

            videoPath = path.join(tmpDirPath, `original-video-${uuid()}.${utils.getFileExtension(article.video.url)}`);
            return utils.downloadFile(article.video.url, videoPath)
        })
        // Get the original target subslide video
        .then(() => {
            return new Promise((resolve, reject) => {
                originalTargetSubslideVideoPath = path.join(tmpDirPath, `original-video-${uuid()}.${utils.getFileExtension(article.video.url)}`);
                converter.cutVideo(videoPath, originalTargetSubslideVideoPath, originalTargetSubslide.startTime, originalTargetSubslide.endTime - originalTargetSubslide.startTime)
                .then(() => {
                    console.log('got original target subslide video')
                    resolve();
                })
                .catch(reject)
            })
        })
        // Apply previous speeds
        .then(() => {
            return new Promise((resolve) => {
                if (subslides.some(s => s.videoSpeed && s.videoSpeed !== 1 && s.speakerProfile && s.speakerProfile.speakerNumber !== -1)) {
                    const adjustVidepSpeedFuncArray = [];
                    subslides.filter(s => s.videoSpeed && s.videoSpeed !== 1 && s.speakerProfile && s.speakerProfile.speakerNumber !== -1).forEach(subslide => {
                        adjustVidepSpeedFuncArray.push(cb => {
                            console.log('changing speed of ', subslide.slidePosition, subslide.position, subslide.videoSpeed)
                            let videoPath2 = path.join(tmpDirPath, `slowed_video_${uuid()}.${videoPath.split('.').pop()}` )
                            converter.speedVideoAndAudioPart(videoPath, videoPath2, subslide.videoSpeed, subslide.startTime, subslide.endTime)
                            .then(() => {
                                videoPath = videoPath2;
                                console.log('new original video path', videoPath)
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
                        return resolve();
                    })
                } else {
                    return resolve();
                }
            })
        })
        // Cut video to slides
        .then(() => converter.cutSubslidesIntoVideos(subslides, videoPath, tmpDirPath))
        // Change start/end timings
        .then((subslides) => {
            targetSubslideIndex = subslides.findIndex(s => s.slidePosition === parseInt(slidePosition) && s.subslidePosition === parseInt(subslidePosition))
            targetSubslide = subslides[targetSubslideIndex];
            const duration = originalTargetSubslide.endTime - originalTargetSubslide.startTime;

            // const prevSpeedDifference = targetSubslide.videoSpeed - 1;
            const prevDurationDifference = targetSubslide.endTime - originalTargetSubslide.endTime;
            speedDifference = videoSpeed - (targetSubslide.videoSpeed || 1);

            const durationDifference = (-speedDifference * duration)
            // get duration difference/
            // add duration difference to the end time
            // adjust the timing of the following slides and add duration difference to start and end times
            console.log('prev duration difference', prevDurationDifference)
            console.log('duration difference', durationDifference)

            // Remove prev difference
            // targetSubslide.endTime -= prevDurationDifference; 
            // add new difference
            targetSubslide.endTime += durationDifference;
            console.log('new end time', targetSubslide.startTime, targetSubslide.endTime)
            subslides.filter((_, i) => i > targetSubslideIndex).forEach(subslide => {
                // Remove previouse difference
                // subslide.startTime -= prevDurationDifference;
                // subslide.endTime -= prevDurationDifference;
                // add new difference
                subslide.startTime += durationDifference;
                subslide.endTime += durationDifference;
            })
            return Promise.resolve(subslides)
        })
        // apply scaling
        .then((videofiedSubslides) => {
            return new Promise((resolve, reject) => {
                const outPath = path.join(tmpDirPath, `speeded-video-${uuid()}.${utils.getFileExtension(targetSubslide.video)}`);
                // const originalSlicePart = path.join(tmpDirPath, `original-slice-video-${uuid()}.${utils.getFileExtension(targetSubslide.video)}`);
                console.log('speeding video', videoSpeed)
                converter.speedVideo(originalTargetSubslideVideoPath, outPath, videoSpeed)
                // converter.speedVideo(originalTargetSubslide.media[0].url, outPath, videoSpeed)
                    .then(() => {
                        targetSubslide.video = outPath;
                        resolve(videofiedSubslides)
                    })
                    .catch(err => reject(err));
            })
        })
        .then((videofiedSubslides) => {
            return new Promise((resolve, reject) => {
                // Upload speeded video
                // Upload Subslides content
                const videoName = targetSubslide.video.split('/').pop();
                storageService.saveFile('speeded_slides', videoName, fs.createReadStream(targetSubslide.video))
                    .then((res) => {
                        targetSubslide.media[0].url = res.url;
                        targetSubslide.media[0].mediaKey = res.data.Key;
                        targetSubslide.media[0].duration = targetSubslide.endTime - targetSubslide.startTime;
                        targetSubslide.videoSpeed = videoSpeed;
                        resolve(videofiedSubslides);
                    })
                    .catch(reject);
            })
        })
        .then((subslides) => {

            const slidesUpdate = {
                videoSpeedLoading: false,
            };
            // Perform database update for target subslide
            /*
                Updated fields:
                1- startTime
                2- endTime
                3- media[0].duration
                4- media[0].mediaKey
                5- media[0].url
            */
            const targetSubslideUpdateField = `slides.${targetSubslide.slidePosition}.content.${targetSubslide.subslidePosition}`

            slidesUpdate[`${targetSubslideUpdateField}.startTime`] = targetSubslide.startTime;
            slidesUpdate[`${targetSubslideUpdateField}.endTime`] = targetSubslide.endTime;
            slidesUpdate[`${targetSubslideUpdateField}.videoSpeed`] = videoSpeed;
            slidesUpdate[`${targetSubslideUpdateField}.media.0.duration`] = targetSubslide.endTime - targetSubslide.startTime;
            slidesUpdate[`${targetSubslideUpdateField}.media.0.mediaKey`] = targetSubslide.media[0].mediaKey;
            slidesUpdate[`${targetSubslideUpdateField}.media.0.url`] = targetSubslide.media[0].url;

            // Perform database update for subslides following the target subslide
            /*
                Updated fields:
                1- startTime
                2- endTime
            */
            subslides.filter((_, i) => i > targetSubslideIndex).forEach((subslide) => {
                const updateField = `slides.${subslide.slidePosition}.content.${subslide.subslidePosition}`
                slidesUpdate[`${updateField}.startTime`] = subslide.startTime;
                slidesUpdate[`${updateField}.endTime`] = subslide.endTime;
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


module.exports = onUpdateArticleSlideVideoSpeed;