const fs = require("fs");
const uuid = require("uuid").v4;
const path = require("path");

const utils = require("../utils");
const converter = require("../converter");

const { storageService } = require("../services");
const { queues } = require("../constants");

const onConvertVideoToArticle = (channel) => (msg) => {
  const { id, videoUrl } = JSON.parse(msg.content.toString());
  let tmpFiles = [];
  let video;
  let videoDuration;
  let videoPath;
  let thumbnailUrl = '';
  // download original video
  // cut it using the timing provided by the user
  // cut silent parts and add them as slides
  // uploaded cutted parts
  // cleanup
  if (!videoUrl) return channel.ack(msg)
  let thumbnailPath = `${path.join(
    __dirname,
    "../tmp"
  )}/thumbnail-${uuid()}.png`;
  let compressedVideoPath;

  videoPath = `${path.join(
    __dirname,
    "../tmp"
  )}/${uuid()}.${utils.getFileExtension(videoUrl)}`;

  compressedVideoPath = `${path.join(
    __dirname,
    "../tmp"
  )}/compressed_${uuid()}.${utils.getFileExtension(videoUrl)}`;
  utils
    .downloadFile(videoUrl, videoPath)
    // Generate thumbnil image
    .then((videoPath) => {
      tmpFiles.push(videoPath);
      return converter.generateThumbnailFromVideo(
        videoPath,
        thumbnailPath,
        "00:00:01.000"
      );
    })
    .then(() => {
      tmpFiles.push(thumbnailPath);
      return utils.getRemoteFileDuration(videoPath)
    })
    .then((duration) => {
      videoDuration = parseFloat(duration).toFixed(3);
      console.log("saving thumbnail Image");
      return storageService.saveFile(
        "thumbnails",
        thumbnailPath.split("/").pop(),
        fs.createReadStream(thumbnailPath)
      );
    })
    .then((uploadRes) => {
      thumbnailUrl = uploadRes.url;
      channel.sendToQueue(queues.GENERATE_VIDEO_THUMBNAIL_FINISH, new Buffer(JSON.stringify({ id, url: uploadRes.url, duration: videoDuration })), { persistent: true });
      console.log("Compressing video");
      return converter.compressVideo(videoPath, compressedVideoPath);
    })
    .then(() => {
      tmpFiles.push(compressedVideoPath);
      return storageService.saveFile(
        "compressed_videos",
        compressedVideoPath.split("/").pop(),
        fs.createReadStream(compressedVideoPath)
      );
    })
    .then((uploadRes) => {
      channel.sendToQueue(queues.COMPRESS_VIDEO_FINISH, new Buffer(JSON.stringify({ id, url: uploadRes.url })), { persistent: true });
      return Promise.resolve();
    })
    .then(() => {
      console.log("done");
      utils.cleanupFiles(tmpFiles);
      channel.ack(msg);
    })
    .catch((err) => {
      channel.sendToQueue(queues.GENERATE_VIDEO_THUMBNAIL_FINISH, new Buffer(JSON.stringify({ id, url: thumbnailUrl, duration: videoDuration })), { persistent: true });
      console.log(err);
      utils.cleanupFiles(tmpFiles);
      channel.ack(msg);
    });
};

module.exports = onConvertVideoToArticle;
