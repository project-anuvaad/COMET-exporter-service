
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

const onUpdateArticleSlideVideoSlice = channel => (msg) => {
    const { articleId, startTime, endTime, slidePosition, subslidePosition } = JSON.parse(msg.content.toString());
    let article;
    let videoPath;
    const tmpDirPath = path.join(__dirname, `../tmp/${uuid()}`);
    fs.mkdirSync(tmpDirPath)
    let subslides;
    let targetSubslideIndex;
    let targetSubslide;
    // download original video
    // cut it using the timing provided by the user
    // cut silent parts and add them as slides
    // uploaded cutted parts
    // cleanup
    // channel.ack(msg);
    console.log('=========== onUpdateArticleSlideVideoSlice ====================', articleId, slidePosition, subslidePosition)
    articleService.findById(articleId)
        .then((a) => {
            if (!a) throw new Error('Invalid article id');
            article = a;
            return videoService.findById(article.video)
        })
        .then(v => {
            article.video = v;
            return Promise.resolve(article);
        })
        // Download media
        .then(() => {
            // Use original article to get fresh media
            subslides = article.slides.slice()
                .reduce((acc, s) => s.content && s.content.length > 0 ? acc.concat(s.content.map((ss) => ({ ...ss, slidePosition: s.position, subslidePosition: ss.position }))) : acc, []).sort((a, b) => a.startTime - b.startTime);
            videoPath = path.join(tmpDirPath, `original-video-${uuid()}.${utils.getFileExtension(article.video.url)}`);
            return utils.downloadFile(article.video.url, videoPath)
        })
        // Change start/end timings
        .then(() => {
            targetSubslideIndex = subslides.findIndex(s => s.slidePosition === parseInt(slidePosition) && s.subslidePosition === parseInt(subslidePosition))
            targetSubslide = subslides[targetSubslideIndex];

            return new Promise((resolve, reject) => {
                const outPath = path.join(tmpDirPath, `sliced-video-${uuid()}.${utils.getFileExtension(article.video.url)}`);
                converter.cutVideo(videoPath, outPath, startTime, endTime - startTime)
                    .then(() => {
                        targetSubslide.video = outPath;
                        resolve(targetSubslide); 
                    })
                    .catch(err => reject(err));
            })
        })
        .then((targetSubslide) => {
            return new Promise((resolve, reject) => {
                // Upload speeded video
                // Upload Subslides content
                const videoName = targetSubslide.video.split('/').pop();
                storageService.saveFile('slides', videoName, fs.createReadStream(targetSubslide.video))
                    .then((res) => {
                        targetSubslide.startTime = startTime;
                        targetSubslide.endTime = endTime;
                        targetSubslide.media[0].url = res.url;
                        targetSubslide.media[0].mediaKey = res.data.Key;
                        targetSubslide.media[0].duration = targetSubslide.endTime - targetSubslide.startTime;
                        resolve(targetSubslide);
                    })
                    .catch(reject);
            })
        })
        .then((targetSubslide) => {

            const slidesUpdate = {
                videoSliceLoading: false,
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
            slidesUpdate[`${targetSubslideUpdateField}.media.0.duration`] = targetSubslide.endTime - targetSubslide.startTime;
            slidesUpdate[`${targetSubslideUpdateField}.media.0.mediaKey`] = targetSubslide.media[0].mediaKey;
            slidesUpdate[`${targetSubslideUpdateField}.media.0.url`] = targetSubslide.media[0].url;
            console.log('slides update', slidesUpdate)
            return articleService.updateById(articleId, slidesUpdate)
        })
        .then(() => {
            console.log('done updating');
            channel.ack(msg);
            // utils.cleanupDir(tmpDirPath)
        })
        .catch(err => {
            console.log(err);
            console.log('====================')
            utils.cleanupDir(tmpDirPath);
            articleService.updateById(articleId, { videoSliceLoading: false })
                .then(() => {

                })
                .catch(err => {
                    console.log(err);
                })
            channel.ack(msg);
        })
}


module.exports = onUpdateArticleSlideVideoSlice;