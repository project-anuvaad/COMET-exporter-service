const fs = require('fs');
const uuid = require('uuid').v4;
const path = require('path');

const utils = require('../utils');
const converter = require('../converter');

const {
    storageService,
    videoService,
} = require('../services');

const onConvertVideoToArticle = channel => (msg) => {
    const { videoId } = JSON.parse(msg.content.toString());
    let tmpFiles = [];
    let video;
    let videoPath;
    // download original video
    // cut it using the timing provided by the user
    // cut silent parts and add them as slides
    // uploaded cutted parts
    // cleanup

    videoService.findById(videoId)
        .then(v => {
            if (!v) throw new Error('Invalid video id');
            console.log('Generating thumbnail for vidoe', v)
            video = v;
            videoPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(video.url)}`;
            return utils.downloadFile(video.url, videoPath);
        })
        // Generate thumbnil image
        .then((videoPath) => {
            const thumbnailPath = `${path.join(__dirname, '../tmp')}/thumbnail-${uuid()}.png`;
            return converter.generateThumbnailFromVideo(videoPath, thumbnailPath, '00:00:01.000')
        })
        .then((thumbnailPath) => {
            tmpFiles.push(thumbnailPath);
            return storageService.saveFile('thumbnails', thumbnailPath.split('/').pop(), fs.createReadStream(thumbnailPath))
        })
        .then((uploadRes) => {
            return videoService.updateById(videoId, { thumbnailUrl: uploadRes.url })
        })
        .then(() => {
            console.log('done');
            utils.cleanupFiles(tmpFiles);
            channel.ack(msg);
        })
        .catch(err => {
            console.log(err);
            utils.cleanupFiles(tmpFiles);
            channel.ack(msg);
        })
}


module.exports = onConvertVideoToArticle;