const path = require("path");
const uuid = require("uuid").v4;
const fs = require("fs");

const { storageService } = require("../services");

const async = require("async");
const queues = require("../constants").queues;
const utils = require("../utils");
const converter = require("../converter");

const onArchiveTranslationAudios = (channel) => (msg) => {
  const { id, slides, langCode, title } = JSON.parse(msg.content.toString());
  console.log("got request to archive translation audios", id);
  const tmpDirName = uuid();
  const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
  fs.mkdirSync(tmpDirPath);
  const allSubslides = slides
    .reduce((acc, s) => acc.concat(s.content), [])
    .filter((s) => s.audio)
    .sort((a, b) => a.startTime - b.startTime)
    .map((s, index) => ({ ...s, position: index }));
  const downloadMedia = new Promise((resolve, reject) => {
    // Generate audios zip file
    console.log("geenrating archive");
    // Download audios locally
    const downloadAudioFuncArray = [];
    allSubslides.forEach((subslide) => {
      downloadAudioFuncArray.push((cb) => {
        const filePath = path.join(
          tmpDirPath,
          `audio-${uuid()}.${subslide.audio.split(".").pop()}`
        );
        utils
          .downloadFile(subslide.audio, filePath)
          .then(() => {
              console.log('downloaded', subslide.audio)
            subslide.audioPath = filePath;
            return cb();
          })
          .catch(cb);
      });
    });
    async.parallelLimit(downloadAudioFuncArray, 2, (err) => {
      if (err) return reject(err);
      updateTranslationExportAudioArchiveProgress(channel, id, 50);
      return resolve(allSubslides);
    });
  });
  downloadMedia
    // Convert audios to mp3
    .then((allSubslides) => {
      return new Promise((resolve) => {
          console.log('converting to mp3')
        const convertAudioFuncArray = [];
        allSubslides.forEach((subslide) => {
          console.log(
            "file extension",
            utils.getFileExtension(subslide.audioPath),
            utils.getFileExtension(subslide.audioPath) !== "mp3"
          );
          if (utils.getFileExtension(subslide.audioPath) !== "mp3") {
            convertAudioFuncArray.push((cb) => {
              converter
                .convertToMp3(subslide.audioPath)
                .then((newPath) => {
                  subslide.audioPath = newPath;
                  console.log("new path is", subslide.audioPath);
                  return cb();
                })
                .catch((err) => {
                  console.log("error converting to mp3", err);
                  return cb();
                });
            });
          }
        });
        async.parallelLimit(convertAudioFuncArray, 2, (err) => {
          if (err) {
            console.log("error converting all to mp3", err);
          }
          return resolve(allSubslides);
        });
      });
    })
    .then((allSubslides) => {
      return new Promise((resolve) => {
        const audios = allSubslides.map((subslide) => ({
          path: subslide.audioPath,
          name: subslide.name
            ? `${subslide.position}-${subslide.name}.${utils.getFileExtension(
                subslide.audioPath
              )}`
            : `${langCode}_${title}_audio_${
                subslide.position
              }.${utils.getFileExtension(subslide.audioPath)}`,
        }));
        const archivePath = path.join(
          tmpDirPath,
          `${langCode}-${title}-audios-${uuid()}.zip`
        );
        console.log(archivePath, audios);
        utils
          .archiveFiles(audios, "zip", archivePath)
          .then(() => {
            // Upload archive
            console.log("uploading audios");
            updateTranslationExportAudioArchiveProgress(channel, id, 70);
            return storageService.saveFile(
              "translationAudios",
              archivePath.split("/").pop(),
              fs.createReadStream(archivePath)
            );
          })
          .then((uploadRes) => {
            console.log("done archiving");
            return resolve(uploadRes);
          })
          .then(() => {
            console.log("done archiving");
            return resolve();
          })
          .catch((err) => {
            // If that fails that's fine, proceed to videos
            console.log("error archiving audios", err);
            return resolve();
          });
      });
    })
    .then((uploadRes) => {
      utils.cleanupDir(path.join(__dirname, `../${tmpDirName}`));
      channel.ack(msg);
      updateTranslationExportAudioArchiveProgress(channel, id, 90);
      channel.sendToQueue(
        queues.ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH,
        new Buffer(JSON.stringify({ id, url: uploadRes.url })),
        { persistent: true }
      );
    })
    .catch((err) => {
      utils.cleanupDir(path.join(__dirname, `../${tmpDirName}`));
      console.log(err, " error from catch");
      channel.ack(msg);
      updateTranslationExportAudioArchiveProgress(channel, id, 0);
    });
};

function updateTranslationExportAudioArchiveProgress(channel, id, progress) {
  channel.sendToQueue(
    queues.ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_PROGRESS,
    new Buffer(JSON.stringify({ id, progress })),
    { persistent: true }
  );
}

module.exports = onArchiveTranslationAudios;
