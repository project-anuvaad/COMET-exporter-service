const fs = require("fs");
const async = require("async");
const uuid = require("uuid").v4;
const path = require("path");
const queues = require("../constants").queues;

const { storageService } = require("../services");

const utils = require("../utils");
const converter = require("../converter");

const onConvertVideoToArticle = (channel) => (msg) => {
  const { id, videoUrl, slides, speakersProfile, toEnglish } = JSON.parse(
    msg.content.toString()
  );
  let tmpFiles = [];
  let videoPath;
  // download original video
  // cut it using the timing provided by the user
  // cut silent parts and add them as slides
  // uploaded cutted parts
  // cleanup
  if (!videoUrl || !id || !slides || !speakersProfile) {
    channel.ack(msg);
    return channel.sendToQueue(
      queues.CONVERT_VIDEO_TO_ARTICLE_FINISH_QUEUE,
      new Buffer(JSON.stringify({ id, status: "failed" })),
      { persistent: true }
    );
  }
  const downloadUrl = videoUrl;
  videoPath = `${path.join(
    __dirname,
    "../tmp"
  )}/${uuid()}.${utils.getFileExtension(videoUrl)}`;

  utils
    .downloadFile(downloadUrl, videoPath)
    .then((videoPath) => {
      tmpFiles.push(videoPath);
      return converter.cutSlidesIntoVideos(slides.slice(), videoPath);
    })
    .then((slides) => {
      if (toEnglish) {
        console.log("directly to english, generating tts slides");
        return converter.convertSlidesTextToSpeach(
          "en",
          speakersProfile,
          slides
        );
      } else {
        return converter.extractAudioFromSlidesVideos(slides);
      }
    })
    .then((slides) => {
      return new Promise((resolve, reject) => {
        if (!toEnglish) return resolve(slides);
        return converter
          .matchSlidesAudioWithVideoDuration(slides)
          .then(resolve)
          .catch(reject);
      });
    })
    .then((slides) => {
      return new Promise((resolve, reject) => {
        slides.forEach((v) => tmpFiles.push(v.video) && tmpFiles.push(v.audio));
        console.log("after cut");
        const uploadFuncArray = [];
        slides.forEach((video) => {
          uploadFuncArray.push((cb) => {
            const videoName = video.video.split("/").pop();
            const audioName = video.audio.split("/").pop();
            storageService
              .saveFile("slides", videoName, fs.createReadStream(video.video))
              .then((res) => {
                video.url = res.url;
                video.mediaKey = res.data.Key;
                console.log("uploaded video", videoName);
                storageService
                  .saveFile(
                    "slides",
                    audioName,
                    fs.createReadStream(video.audio)
                  )
                  .then((res) => {
                    video.audio = res.url;
                    video.audioKey = res.data.Key;
                    console.log("uploaded audio", audioName);
                    cb();
                  })
                  .catch((err) => cb(err));
              })
              .catch((err) => {
                cb(err);
              });
          });
        });
        async.parallelLimit(uploadFuncArray, 2, (err) => {
          console.log("done uploading");
          if (err) return reject(err);
          return resolve(slides);
        });
      });
    })
    .then((videoSlides) => {
      // Update slides with videos
      console.log("updating slides with video");
      const modifiedSlides = slides.slice();
      videoSlides.forEach((videoSlide) => {
        modifiedSlides[videoSlide.slideIndex].content[
          videoSlide.subslideIndex
        ].media = [
          {
            url: videoSlide.url,
            mediaKey: videoSlide.mediaKey,
            mediaType: "video",
            duration: videoSlide.endTime - videoSlide.startTime,
          },
        ];
        modifiedSlides[videoSlide.slideIndex].content[
          videoSlide.subslideIndex
        ].audio = videoSlide.audio;
        modifiedSlides[videoSlide.slideIndex].content[
          videoSlide.subslideIndex
        ].audioKey = videoSlide.audioKey;
      });
      // set position on subslides
      modifiedSlides.forEach((slide) => {
        slide.content.forEach((subslide, index) => {
          subslide.position = index;
        });
      });
      //   return articleService.updateById(article._id, {
      //     slides: modifiedSlides,
      //     converted: true,
      //   });
      // })
      // .then(() => {
      //   return videoService.updateById(videoId, {
      //     status: "done",
      //     article: articleId,
      //   });
      // })
      // .then(() => {
      console.log("done");
      utils.cleanupFiles(tmpFiles);
      channel.ack(msg);
      channel.sendToQueue(
        queues.CONVERT_VIDEO_TO_ARTICLE_FINISH_QUEUE,
        new Buffer(JSON.stringify({ id, slides: modifiedSlides })),
        { persistent: true }
      );
    })
    .catch((err) => {
      console.log(err);
      utils.cleanupFiles(tmpFiles);
      channel.ack(msg);
      channel.sendToQueue(
        queues.CONVERT_VIDEO_TO_ARTICLE_FINISH_QUEUE,
        new Buffer(JSON.stringify({ id, status: "failed" })),
        { persistent: true }
      );
    });
};

module.exports = onConvertVideoToArticle;
