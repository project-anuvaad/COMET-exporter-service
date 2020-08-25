const fs = require("fs");
const async = require("async");
const uuid = require("uuid").v4;
const path = require("path");

const utils = require("../utils");
const converter = require("../converter");

const { storageService } = require("../services");
const { queues } = require("../constants");

const onUpdateArticleSlideVideoSlice = (channel) => (msg) => {
  const {
    id,
    videoUrl,
    slides,
    startTime,
    endTime,
    slidePosition,
    subslidePosition,
  } = JSON.parse(msg.content.toString());
  let article;
  let videoPath;
  const tmpDirPath = path.join(__dirname, `../tmp/${uuid()}`);
  fs.mkdirSync(tmpDirPath);
  let subslides;
  let targetSubslideIndex;
  let targetSubslide;
  // download original video
  // cut it using the timing provided by the user
  // cut silent parts and add them as slides
  // uploaded cutted parts
  // cleanup
  // channel.ack(msg);
  if (!videoUrl) return channel.ack(msg);
  console.log(
    "=========== onUpdateArticleSlideVideoSlice ====================",
    id,
    slidePosition,
    subslidePosition
  );
  subslides = slides
    .slice()
    .reduce(
      (acc, s) =>
        s.content && s.content.length > 0
          ? acc.concat(
              s.content.map((ss) => ({
                ...ss,
                slidePosition: s.position,
                subslidePosition: ss.position,
              }))
            )
          : acc,
      []
    )
    .sort((a, b) => a.startTime - b.startTime);
  videoPath = path.join(
    tmpDirPath,
    `original-video-${uuid()}.${utils.getFileExtension(videoUrl)}`
  );
  utils
    .downloadFile(videoUrl, videoPath)
    // Change start/end timings
    .then(() => {
      targetSubslideIndex = subslides.findIndex(
        (s) =>
          s.slidePosition === parseInt(slidePosition) &&
          s.subslidePosition === parseInt(subslidePosition)
      );
      targetSubslide = subslides[targetSubslideIndex];

      return new Promise((resolve, reject) => {
        const outPath = path.join(
          tmpDirPath,
          `sliced-video-${uuid()}.${utils.getFileExtension(videoUrl)}`
        );
        converter
          .cutVideo(videoPath, outPath, startTime, endTime - startTime)
          .then(() => {
            targetSubslide.video = outPath;
            resolve(targetSubslide);
          })
          .catch((err) => reject(err));
      });
    })
    .then((targetSubslide) => {
      return new Promise((resolve, reject) => {
        // Upload speeded video
        // Upload Subslides content
        const videoName = targetSubslide.video.split("/").pop();
        storageService
          .saveFile(
            "slides",
            videoName,
            fs.createReadStream(targetSubslide.video)
          )
          .then((res) => {
            targetSubslide.startTime = startTime;
            targetSubslide.endTime = endTime;
            targetSubslide.media[0].url = res.url;
            targetSubslide.media[0].mediaKey = res.data.Key;
            targetSubslide.media[0].duration =
              targetSubslide.endTime - targetSubslide.startTime;
            resolve(targetSubslide);
          })
          .catch(reject);
      });
    })
    .then((targetSubslide) => {
      channel.sendToQueue(
        queues.UPDATE_ARTICLE_SLIDE_VIDEO_SLICE_FINISH,
        new Buffer(
          JSON.stringify({
            id,
            slidePosition,
            subslidePosition,
            startTime: targetSubslide.startTime,
            endTime: targetSubslide.endTime,
            duration: targetSubslide.endTime - targetSubslide.startTime,
            mediaKey: targetSubslide.media[0].mediaKey,
            url: targetSubslide.media[0].url,
          })
        )
      );
      console.log("done updating");
      channel.ack(msg);
    })
    .catch((err) => {
      console.log(err);
      console.log("====================");
      channel.sendToQueue(
        queues.UPDATE_ARTICLE_SLIDE_VIDEO_SLICE_FINISH,
        new Buffer(
          JSON.stringify({
            id,
            status: "failed",
          })
        )
      );
      utils.cleanupDir(tmpDirPath);
      channel.ack(msg);
    });
};

module.exports = onUpdateArticleSlideVideoSlice;
