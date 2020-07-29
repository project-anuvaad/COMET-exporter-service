const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const uuid = require("uuid").v4;
const utils = require("./utils");
const async = require("async");

const { textToSpeechService } = require("./services");

// function normalizeCommandText(text) {
//     return text.replace(/\:|\'|\"/g, '');
// }

function cutVideo(videoPath, targetPath, start, duration) {
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -y -ss ${utils.formatCutTime(
      start
    )} -i ${videoPath} -t ${duration} ${targetPath}`;
    exec(command, (err) => {
      if (err) return reject(err);
      if (!fs.existsSync(targetPath))
        return reject(new Error("Something went wrong"));
      return resolve(targetPath);
    });
  });
}

function getAudioNumberOfChannels(audioPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffprobe -i ${audioPath} -show_entries stream=channels -select_streams a:0 -of compact=p=0:nk=1 -v 0`;
    exec(cmd, (err, stdout) => {
      if (err) return reject(err);
      console.log("number of channels", stdout);
      return resolve(parseInt(stdout));
    });
  });
}

function getAudioMonoOrStereo(audioPath) {
  return new Promise((resolve) => {
    getAudioNumberOfChannels(audioPath)
      .then((channels) => {
        if (channels === 2) return resolve("stereo");
        return resolve("mono");
      })
      .catch((err) => {
        // Assume by default 1 channel
        console.log(err);
        return resolve("mono");
      });
  });
}

function normalizeAudio(audioPath, targetPath) {
  return new Promise((resolve, reject) => {
    const commands = {
      mono: `ffmpeg -i ${audioPath} -af "anoisesrc=a=0.5:d=9:c=pink:r=48000,aformat=channel_layouts=mono[pad];
                    [pad][in]concat=n=2:v=0:a=1,
                     bass=g=+10:f=150:t=q:w=0.5,
                     treble=g=+12:f=6500:t=q,
                     loudnorm=i=-9:tp=-3:lra=7,
                     atrim=9,
                     asetpts=PTS-STARTPTS,
                     aresample=48000,
                     adeclick" ${targetPath}`,
      stereo: `ffmpeg -i ${audioPath} -af "anoisesrc=a=0.5:d=9:c=pink:r=48000,aformat=channel_layouts=stereo[pad];
                    [pad][in]concat=n=2:v=0:a=1,
                     bass=g=+10:f=150:t=q:w=0.5,
                     treble=g=+12:f=6500:t=q,
                     loudnorm=i=-9:tp=-3:lra=7,
                     atrim=9,
                     asetpts=PTS-STARTPTS,
                     aresample=48000,
                     adeclick" ${targetPath}`,
    };
    getAudioMonoOrStereo(audioPath)
      .then((type) => {
        console.log("channel type", type);
        const command = commands[type];
        exec(command, (err) => {
          if (err) return reject(err);
          return resolve(targetPath);
        });
      })
      .catch(reject);
  });
}

function extractAudioFromSlidesVideos(slides) {
  return new Promise((resolve, reject) => {
    const extractAudioFuncArray = [];
    slides.forEach((videoSlide) => {
      extractAudioFuncArray.push((cb) => {
        const targetPath = `tmp/audio-${uuid()}.mp3`;
        extractAudioFromVideo(videoSlide.video, targetPath)
          .then(() => {
            videoSlide.audio = targetPath;
            cb();
          })
          .catch((err) => {
            cb(err);
          });
      });
    });
    async.parallelLimit(extractAudioFuncArray, 1, (err) => {
      if (err) return reject(err);
      return resolve(slides);
    });
  });
}

function extractAudioFromVideo(videoPath, targetPath) {
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -y -i ${videoPath} -map 0:a:0 ${targetPath}`;
    exec(command, (err) => {
      if (err) return reject(err);
      if (!fs.existsSync(targetPath))
        return reject(new Error("Something went wrong"));
      return resolve(targetPath);
    });
  });
}

function cutSubslidesIntoVideos(subslides, videoPath, tmpDir) {
  return new Promise((resolve, reject) => {
    const videoCuts = [];
    subslides.forEach((subslide) => {
      videoCuts.push((cb) => {
        const targetPath = path.join(tmpDir || 'tmp/', `${uuid()}-${uuid()}.${videoPath
          .split(".")
          .pop()}`);
        // const targetPath = `tmp/${index}-${uuid()}.${videoPath.split('.').pop()}`;
        cutVideo(
          videoPath,
          targetPath,
          subslide.startTime,
          subslide.endTime - subslide.startTime
        )
          .then(() => {
            cb(null, { ...subslide, video: targetPath });
          })
          .catch(cb);
      });
    });

    async.series(videoCuts, (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });
}

function cutSlidesIntoVideos(slides, videoPath) {
  return new Promise((resolve, reject) => {
    const videoCuts = [];
    slides.forEach((slide, slideIndex) => {
      slide.content.forEach((subslide, index) => {
        videoCuts.push((cb) => {
          const targetPath = `tmp/${slideIndex}.${index}${uuid()}.${videoPath
            .split(".")
            .pop()}`;
          // const targetPath = `tmp/${index}-${uuid()}.${videoPath.split('.').pop()}`;
          cutVideo(
            videoPath,
            targetPath,
            subslide.startTime,
            subslide.endTime - subslide.startTime
          )
            .then(() => {
              console.log("done", slideIndex, index);
              cb(null, {
                ...subslide,
                video: targetPath,
                slideIndex,
                subslideIndex: index,
              });
            })
            .catch(cb);
        });
      });
    });

    async.series(videoCuts, (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });
}

function convertSlidesTextToSpeach(lang, speakersProfile, slidesArray) {
  return new Promise((resolve, reject) => {
    console.log(
      "====================== generating tts ======================== "
    );
    const slides = slidesArray.slice();
    const convFuncArray = [];
    slides.forEach((slide) => {
      convFuncArray.push((cb) => {
        const targetPath = path.join(
          __dirname,
          "tmp",
          `tts_audio${uuid()}.mp3`
        );
        if (slide.text && slide.text.trim()) {
          const params = {
            text: slide.text,
            langCode: lang,
            speakersProfile,
            speakerNumber: slide.speakerProfile.speakerNumber,
            targetPath,
            outputFormat: "mp3",
          };

          textToSpeechService
            .convertTextToSpeech(params, targetPath)
            .then(() => {
              slide.audio = targetPath;
              cb();
            })
            .catch((err) => cb(err));
        } else {
          extractAudioFromVideo(slide.video, targetPath)
            .then(() => {
              slide.audio = targetPath;
              cb();
            })
            .catch((err) => cb(err));
        }
      });
    });
    async.parallelLimit(convFuncArray, 1, (err) => {
      if (err) return reject(err);
      return resolve(slides);
    });
  });
}

function slowAudio(audioPath, targetPath, atempoRatio) {
  return new Promise((resolve, reject) => {
    exec(
      `ffmpeg -i ${audioPath} -filter:a "atempo=${atempoRatio}" -vn ${targetPath}`,
      (err) => {
        if (err) return reject(err);
        return resolve(targetPath);
      }
    );
  });
}

function slowAudioToDuration(audioUrl, targetDuration) {
  return new Promise((resolve, reject) => {
    let atempoRatio;
    utils
      .getRemoteFileDuration(audioUrl)
      .then((duration) => {
        if (!duration)
          throw new Error("Something went wrong while getting duration");
        atempoRatio = duration / targetDuration;
        const newPath = path.join(
          __dirname,
          "tmp",
          `slowed_audio-${uuid()}.${audioUrl.split(".").pop()}`
        );
        return slowAudio(audioUrl, newPath, atempoRatio);
      })
      .then((newPath) => {
        return resolve(newPath);
      })
      .catch(reject);
  });
}

function matchSlidesAudioWithVideoDuration(slides) {
  return new Promise((resolve, reject) => {
    const matchFuncArray = [];
    slides.forEach((slide) => {
      if (!slide.text || !slide.text.trim() || !slide.video || !slide.audio)
        return;

      matchFuncArray.push((cb) => {
        let videoDuration;
        utils
          .getRemoteFileDuration(slide.video)
          .then((duration) => {
            videoDuration = duration;
            return utils.getRemoteFileDuration(slide.audio);
          })
          .then((audioDuration) => {
            if (audioDuration < videoDuration) {
              return cb();
            }
            console.log(
              "slowing audio duration",
              slide,
              audioDuration,
              videoDuration
            );
            // Slow the duration and keep a margin of 200ms
            return slowAudioToDuration(slide.audio, videoDuration - 0.2).then(
              (newAudioPath) => {
                fs.unlink(slide.audio, () => {
                  slide.audio = newAudioPath;
                  return cb();
                });
              }
            );
          })
          .catch(cb);
      });
    });

    async.parallelLimit(matchFuncArray, 1, (err) => {
      if (err) return reject(err);
      return resolve(slides);
    });
  });
}

function addAudioToVideo(videoPath, audioPath, outPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i ${videoPath} -i ${audioPath} -map 0:v:0? -map 1:a:0 -c:v copy ${outPath}`;
    // const cmd = `ffmpeg -i ${videoPath} -i ${audioPath} -map 0:v:0 -map 1:a:0 ${outPath}`;
    exec(cmd, (err) => {
      if (err) {
        return reject(err);
      }
      if (!fs.existsSync(outPath))
        return reject(new Error("Something went wrong"));
      return resolve(outPath);
    });
  });
}

// function cutToDuration(filePath, outPath, duration) {
//     return new Promise((resolve, reject) => {
//         const command = `ffmpeg -i ${filePath} -t ${duration} ${outPath}`;
//         exec(command, (err) => {
//             if (err) return reject(err);
//             return resolve(outPath);
//         })
//     })
// }

function overlayAudioOnVideo(videoPath, audioPath, volume, outPath) {
  return new Promise((resolve, reject) => {
    utils
      .getRemoteFileDuration(videoPath)
      .then((videoDuration) => {
        console.log("video duration is", videoDuration);
        // Loop the audio file till the end of video duration
        // add audio over the video
        const cmd = `ffmpeg -i ${videoPath} -stream_loop -1 -t ${parseFloat(
          videoDuration
        ).toFixed(
          2
        )} -i ${audioPath} -filter_complex "[1:a]volume=${volume}[a];[a][0:a]amix=inputs=2:duration=longest:dropout_transition=3[a]" -map 0:v -map "[a]" -c:v copy ${outPath}`;
        console.log(cmd);
        // const cmd = `ffmpeg -i ${videoPath} -i ${audioPath} -filter_complex "[0:a][1:a]amerge=inputs=2[a]" -map 0:v -map "[a]" -c:v copy ${outPath}`;
        // const cmd = `ffmpeg -i ${videoPath} -i ${audioPath} -map 0 -map 1 -codec copy ${outPath}`;
        exec(cmd, (err) => {
          if (err) {
            return reject(err);
          }
          if (!fs.existsSync(outPath))
            return reject(new Error("Something went wrong"));
          return resolve(outPath);
        });
      })
      .catch((err) => {
        console.log("error overlaying audio", err);
        return reject(err);
      });
  });
}

function addSilenceToVideo(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -i ${videoPath} -shortest -c:v copy -c:a aac ${outPath}`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      return resolve(outPath);
    });
  });
}

function fadeAudio(filePath, type, { fadeDuration, durationType }, outPath) {
  return new Promise((resolve, reject) => {
    if (durationType === "percentage") {
      utils
        .getRemoteFileDuration(filePath)
        .then((duration) => {
          if (!duration) return reject(new Error("Cannot get file duration"));
          const finalFadeDuration = (fadeDuration * duration) / 100;
          let command = `ffmpeg -i ${filePath}`;
          if (["in", "out"].indexOf(type) !== -1) {
            command += ` -af "afade=t=${type}:st=${
              type === "in" ? "0" : duration - finalFadeDuration
              }:d=${finalFadeDuration}"`;
          } else if (type === "both") {
            command += ` -af "afade=t=in:st=0:d=${finalFadeDuration},afade=t=out:st=${
              duration - finalFadeDuration
              }:d=${finalFadeDuration}"`;
          } else {
            return reject(new Error("Invalid type: in|out|both"));
          }
          command += ` ${outPath}`;
          console.log("fading audio", command);
          exec(command, (err, stdout, stderr) => {
            if (stderr) {
              console.log(stderr);
            }
            if (err) return reject(err);
            return resolve(outPath);
          });
        })
        .catch(reject);
    } else {
      exec(
        `ffmpeg -i ${filePath} -af "afade=t=${type}:st=0:d=${fadeDuration}" ${outPath}`,
        (err) => {
          if (err) return reject(err);
          return resolve(outPath);
        }
      );
    }
  });
}

function speedVideoSilence(videoPath, outputPath, silenceSpeed) {
  return new Promise((resolve, reject) => {
    const jumpcutterPath = path.join(__dirname, "jumpcutter", "jumpcutter.py");
    const tmpDir = `tmpdir_${uuid()}`;
    const cmd = `python3 ${jumpcutterPath} --input_file ${videoPath} --sounded_speed 1 --silent_speed ${silenceSpeed} --output_file ${outputPath} --tmp_dir ${tmpDir}`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      return resolve(outputPath);
    });
  });
}

function speedVideo(videoPath, outputPath, speed) {
  return new Promise((resolve, reject) => {
    let videoSpeedFactor;
    let audioSpeedFactor;
    const speedDifference = speed - 1;
    if (speedDifference < 0) {
      videoSpeedFactor = 1 + -speedDifference ;
    } else {
      videoSpeedFactor = 1 + -speedDifference / 2;
    }
    audioSpeedFactor = 1 + speedDifference/2;
    if (audioSpeedFactor < 0.5) {
      audioSpeedFactor = 0.5;
    }
    const cmd = `ffmpeg -i ${videoPath} -filter:v "setpts=${parseFloat(
      videoSpeedFactor
    ).toFixed(2)}*PTS" ${outputPath}`;
    // const cmd = `ffmpeg -i ${videoPath} -filter:v "setpts=${parseFloat(videoSpeedFactor).toFixed(2)}*PTS" ${outputPath}`
    exec(cmd, (err) => {
      if (err) return reject(err);
      return resolve(outputPath);
    });
  });
}

function speedVideoPart(videoPath, outputPath, speed, startTime, endTime){
  return new Promise((resolve, reject) => {
    let videoSpeedFactor;
    let audioSpeedFactor;
    const speedDifference = speed - 1;
    if (speedDifference < 0) {
      videoSpeedFactor = 1 + -speedDifference ;
    } else {
      videoSpeedFactor = 1 + -speedDifference / 2;
    }
    audioSpeedFactor = 1 + speedDifference/2;
    if (audioSpeedFactor < 0.5) {
      audioSpeedFactor = 0.5;
    }
    const cmd = `ffmpeg -y -i ${videoPath} -filter_complex "[0:v]trim=0:${startTime},setpts=PTS-STARTPTS[v1];[0:v]trim=${startTime}:${endTime},setpts=${parseFloat(videoSpeedFactor).toFixed(2)}*(PTS-STARTPTS)[v2];[0:v]trim=${endTime},setpts=PTS-STARTPTS[v3];[v1][v2][v3]concat=n=3:v=1" -preset superfast -profile:v baseline ${outputPath}`;
    // const cmd = `ffmpeg -i ${videoPath} -filter:v "setpts=${parseFloat(videoSpeedFactor).toFixed(2)}*PTS" ${outputPath}`
    exec(cmd, (err) => {
      if (err) return reject(err);
      return resolve(outputPath);
    });
  });
}

function getProgressFromStdout(totalDuration, chunk, onProgress) {
  const re = /time=([0-9]+):([0-9]+):([0-9]+)/;
  const match = chunk.toString().match(re);
  if (chunk && totalDuration && match && match.length > 3) {
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const total = seconds + minutes * 60 + hours * 60 * 60;
    onProgress(Math.floor((total / totalDuration) * 100));
  }
}

function combineVideos(videos, { onProgress = () => { }, onEnd = () => { } }) {
  const listName = parseInt(Date.now() + Math.random() * 100000);
  const videoPath = `tmp/${listName}.${videos[0].fileName.split(".").pop()}`;
  console.log("combinin", videos.map((v) => v.fileName).join("\n"));
  fs.writeFile(
    `./${listName}.txt`,
    videos.map((video) => `file '${video.fileName}'`).join("\n"),
    (err) => {
      if (err) {
        return onEnd(err);
      }

      const fileNames = `-i ${videos
        .map((item) => item.fileName)
        .join(" -i ")}`;
      const filterComplex = videos
        .map((item, index) => `[${index}:v:0][${index}:a:0]`)
        .join("");

      utils.getFilesDuration(
        videos.map((v) => v.fileName),
        (err, totalDuration) => {
          if (err) {
            totalDuration = 0;
          }
          console.log("got total duration", totalDuration);

          const command = `ffmpeg ${fileNames} \
            -filter_complex "${filterComplex}concat=n=${videos.length}:v=1:a=1[outv][outa]" \
            -map "[outv]" -map "[outa]" ${videoPath}`;
          // const command = `ffmpeg -y -f concat -safe 0 -i ${listName}.txt -c copy ${videoPath}`;
          exec(command, { maxBuffer: 1024 * 500 }, (err) => {
            console.log("command finihsed");
            if (err) {
              onEnd(err);
            } else {
              onEnd(null, `${videoPath}`);
            }
            // clean up
            fs.unlink(`./${listName}.txt`, () => { });
          }).stderr.on("data", (c) => {
            getProgressFromStdout(totalDuration, c, onProgress);
          });
        }
      );
    }
  );
}

function combineAudios(
  audiosPaths,
  audioPath,
  { onProgress = () => { }, onEnd = () => { } } = {}
) {
  return new Promise((resolve, reject) => {
    console.log("combining audios", audiosPaths.join("\n"));
    const fileNames = `-i ${audiosPaths.join(" -i ")}`;
    const filterComplex = audiosPaths
      .map((item, index) => `[${index}:a:0]`)
      .join("");

    utils.getFilesDuration(audiosPaths, (err, totalDuration) => {
      if (err) {
        totalDuration = 0;
        console.log(err);
      }

      const command = `ffmpeg ${fileNames} \
            -filter_complex "${filterComplex}concat=n=${audiosPaths.length}:v=0:a=1[outa]" \
            -map "[outa]" ${audioPath}`;
      exec(command, (err) => {
        console.log("command finihsed");
        if (err) {
          onEnd(err);
          reject(err);
        } else {
          onEnd(null, `${audioPath}`);
          resolve(audioPath);
        }
        // clean up
      }).stderr.on("data", (c) => {
        getProgressFromStdout(totalDuration, c, onProgress);
      });
    });
  });
}

function generateSilentFile(filePath, duration) {
  return new Promise((resolve, reject) => {
    exec(
      `ffmpeg -f lavfi -i anullsrc=channel_layout=5.1:sample_rate=48000 -t ${duration} ${filePath}`,
      (err) => {
        if (err) return reject(err);
        return resolve(filePath);
      }
    );
  });
}

function concatAudiosNoReEncode(audiosPaths, outPath) {
  return new Promise((resolve, reject) => {
    const listName = path.join(__dirname, `extend-audio-list-${uuid()}.txt`);
    fs.writeFile(
      listName,
      audiosPaths.map((a) => `file '${a}'`).join("\n"),
      (err) => {
        if (err) return reject(err);
        exec(`ffmpeg -y -f concat -safe 0 -i ${listName} ${outPath}`, (err) => {
          fs.unlink(listName, (err) => {
            if (err) {
              console.log(err);
            }
          });
          if (err) return reject(err);
          return resolve(outPath);
        });
      }
    );
  });
}

function extendAudioDuration(audioPath, targetPath, targetDuration) {
  return new Promise((resolve, reject) => {
    // Get audio duration
    // Find duration difference
    // Generate silent file with the difference
    // Concat the two files
    let audioDuration = 0;
    let durationDifference = 0;
    const silentFilePath = path.join(
      __dirname,
      `silent-file-${uuid()}.${audioPath.split(".").pop()}`
    );
    utils
      .getRemoteFileDuration(audioPath)
      .then((duration) => {
        if (!duration) throw new Error("Invalid audio file");
        audioDuration = duration;
        durationDifference = targetDuration - audioDuration;
        console.log(
          "difference",
          audioDuration,
          targetDuration,
          durationDifference
        );
        if (durationDifference <= 0) {
          return resolve(audioPath);
        }

        return generateSilentFile(silentFilePath, durationDifference)
          .then(() => {
            return combineAudios([audioPath, silentFilePath], targetPath);
          })
          .then(() => {
            fs.unlink(silentFilePath, () => { });
            resolve(targetPath);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

function convertToMp3(filePath) {
  return new Promise((resolve, reject) => {
    let fileName = filePath.split(".");
    fileName.pop();
    fileName = fileName.join(".");
    const command = `ffmpeg -i ${filePath} -acodec libmp3lame ${fileName}.mp3`;
    exec(command, (err) => {
      if (err) return reject(err);
      return resolve(`${fileName}.mp3`);
    });
  });
}

function changeAudioVolume(filePath, outPath, volume) {
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -i ${filePath} -af "volume=${volume}" ${outPath}`;
    exec(command, (err) => {
      if (err) return reject(err);
      return resolve(outPath);
    });
  });
}

function changeExtension(filePath, from, to) {
  return new Promise((resolve, reject) => {
    let fileName = filePath.split(".");
    fileName.pop();
    fileName = fileName.join(".");
    const command = `ffmpeg -i ${filePath} ${fileName}.${to}`;
    exec(command, (err) => {
      console.log("change done", err);
      if (err) return reject(err);
      return resolve(`${fileName}.${to}`);
    });
  });
}

// Add subtitles track
function burnSubtitlesToVideo(
  videoPath,
  subtitlePath,
  outputPath,
  { onProgress = () => { }, onEnd = () => { } }
) {
  utils
    .getRemoteFileDuration(videoPath)
    .then((videoDuration) => {
      const command = `ffmpeg -i ${videoPath} -vf "ass=${subtitlePath}" ${outputPath}`;
      // const command = `ffmpeg -i ${videoPath} -i ${subtitlePath} -c copy -c:s mov_text ${outputPath}`
      exec(command, (err) => {
        if (err) {
          return onEnd(err);
        }
        return onEnd(null, outputPath);
      }).stderr.on("data", (c) => {
        getProgressFromStdout(videoDuration, c, onProgress);
      });
    })
    .catch((err) => {
      console.log(err);
      return onEnd(err);
    });
}

// function burnSubtitlesToVideo(videoPath, subtitlePath, outputPath, { onProgress = () => {}, onEnd = () => {} }) {
//     utils.getRemoteFileDuration(videoPath)
//     .then((videoDuration) => {
//         let assSubPath = subtitlePath.split('.');
//         assSubPath.pop();
//         assSubPath = assSubPath.join('.');
//         assSubPath += '.ass';
//         exec(`ffmpeg -i ${subtitlePath} ${assSubPath}`, (err) => {
//             if (err) return onEnd(err);

//             const command = `ffmpeg -i ${videoPath} -vf subtitles=${subtitlePath} ${outputPath}`
//             // const command = `ffmpeg -i ${videoPath} -i ${subtitlePath} -c copy -c:s mov_text ${outputPath}`
//             exec(command, (err) => {
//                 if (err) {
//                     return onEnd(err);
//                 }
//                 return onEnd(null, outputPath);
//             })
//             .stderr.on('data', (c) => {
//                 getProgressFromStdout(videoDuration, c, onProgress);
//             })
//         })
//     })
//     .catch(err => {
//         console.log(err);
//         return onEnd(err);
//     })
// }

function generateThumbnailFromVideo(videoPath, thumbnailPath, thumbnailTime) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i ${videoPath} -ss ${thumbnailTime} -vframes 1 ${thumbnailPath}`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      return resolve(thumbnailPath);
    });
  });
}

function getVideoDimensions(videoUrl) {
  return new Promise((resolve, reject) => {
    const cmd = `ffprobe -v error -show_entries stream=width,height -of csv=p=0:s=x ${videoUrl}`;
    exec(cmd, (err, stdout) => {
      if (err) return reject(err);
      const [width, height] = stdout.trim().replace("\n", "").split("x");
      return resolve({ width: parseInt(width), height: parseInt(height) });
    });
  });
}

function getOverlayPositionParams(position) {
  const margin = 0;
  switch (position) {
    case "tl": // TOP LEFT
      return `${margin}:${margin}`;
    case "tr": // TOP RIGHT
      return `(W-w)-${margin}:${margin}`;
    case "bl": // BOTTOM LEFT
      return `${margin}:(H-h)-${margin}`;
    case "br": // BOTTOM RIGHT
      return `(W-w)-${margin}:(H-h)-${margin}`;
    default:
      // default to bottom right
      return `(W-w):(H-h)`;
  }
}

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${videoPath}`,
      (err, stdout) => {
        console.log("video duration ====================", err, stdout);
        if (err) return reject(err);
        return resolve(parseFloat(stdout.replace("\n", "")).toFixed(3));
      }
    );
  });
}

// function changeFileExtension(orignalPath, targetPath) {

// }

/*
    Videos: [
        {
            path: string,
            picInPicPosition: enum = tl, tr, bl, br
            startTime: float
            endTime: float
        }
    ]

*/

function overlayVideosOnVideo(videos, originalViedo, targetVideoPath) {
  return new Promise((resolve, reject) => {
    const originalVideoExtension = originalViedo.split(".").pop().toLowerCase();
    // get original video dimentions
    getVideoDimensions(originalViedo)
      .then(({ width, height }) => {
        if (!width || !height)
          throw new Error("Invalid width|height " + width + "x" + height);
        getVideoDuration(originalViedo)
          .then((duration) => {
            // Normalize file extensions to the original file's extension
            const tmpFiles = [];
            const normalizeExtensionFunArray = [];
            videos
              .filter(
                (v) =>
                  v.path.split(".").pop().toLowerCase() !==
                  originalVideoExtension
              )
              .forEach((video) => {
                normalizeExtensionFunArray.push((cb) => {
                  const newFilePath = path.join(
                    __dirname,
                    "tmp",
                    `overlay-normalized-${Date.now()}.${originalVideoExtension}`
                  );
                  tmpFiles.push(newFilePath);
                  exec(`ffmpeg -i ${video.path} ${newFilePath}`, (err) => {
                    if (err) return cb(err);
                    video.path = newFilePath;
                    return cb();
                  });
                });
              });

            async.parallelLimit(normalizeExtensionFunArray, 2, (err) => {
              if (err) return reject(err);
              let cmd = `ffmpeg -y -i ${originalViedo}`;
              let inputs = "";
              let scales = "";
              let overlays = "";
              let delaystart = "";
              videos.forEach((video, index) => {
                inputs += ` -i ${video.path}`;
                delaystart += `[${index + 1}:v]setpts=PTS-STARTPTS+${parseFloat(
                  video.startTime
                ).toFixed(3)}/TB[delayed${index + 1}]`;
                scales += `[delayed${index + 1}]scale=(${(width * 4) / 12}):(${
                  (height * 4) / 12
                  })[overlayscaled${index + 1}]`;
                if (index === 0) {
                  overlays += "[0:v]";
                } else {
                  overlays += "[outv]";
                }

                overlays += `[overlayscaled${
                  index + 1
                  }]overlay=${getOverlayPositionParams(
                    video.picInPicPosition
                  )}:enable='between(t\\,${parseFloat(video.startTime).toFixed(
                    3
                  )},${parseFloat(video.endTime).toFixed(3)})'[outv]`;
                if (index !== videos.length - 1) {
                  scales += ";";
                  overlays += ";";
                  delaystart += ";";
                }
              });
              // ffmpeg -y -i original.mp4 -i overflow.mp4 -i overflow.mp4 -filter_complex "[1:v]scale=(1920/4):-1[overlayscaled1];[2:v]scale=(1920/4):-1[overlayscaled2];[0:v][overlayscaled1]overlay=(W-w):(H-h):enable='between(t,0,2)'[outv];[outv][overlayscaled2]overlay=0:0:enable='between(t,0,4)'[outv]" -map "[outv]" -map "0:a" output.mp4
              cmd = `${cmd}${inputs} -filter_complex "${delaystart};${scales};${overlays}" -map "[outv]" -map "0:a" -t ${duration} ${targetVideoPath}`;
              console.log("command is", cmd);
              exec(cmd, (err) => {
                console.log("done overlaying videos");
                utils.cleanupFiles(tmpFiles);
                if (err) return reject(err);
                return resolve(targetVideoPath);
              });
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

function compressVideo(videoPath, targetPath) {
  return new Promise((resolve, reject) => {
    // By default, ffmpeg applies compression of videos
    const cmd = `ffmpeg -i ${videoPath} ${targetPath}`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      return resolve(targetPath);
    });
  });
}

module.exports = {
  cutVideo,
  cutSlidesIntoVideos,
  extractAudioFromSlidesVideos,
  extractAudioFromVideo,
  addAudioToVideo,
  overlayAudioOnVideo,
  combineVideos,
  addSilenceToVideo,
  speedVideoSilence,
  speedVideo,
  slowAudioToDuration,
  matchSlidesAudioWithVideoDuration,
  // breakVideoIntoSlides,
  convertSlidesTextToSpeach,
  fadeAudio,
  burnSubtitlesToVideo,
  changeExtension,
  concatAudiosNoReEncode,
  extendAudioDuration,
  combineAudios,
  convertToMp3,
  generateThumbnailFromVideo,
  normalizeAudio,
  generateSilentFile,
  changeAudioVolume,
  cutSubslidesIntoVideos,
  overlayVideosOnVideo,
  compressVideo,
  speedVideoPart,
};

// speedVideoPart('speed_test.mp4', 'speed_out.mp4', 0.5, 5, 10)
// .then(() => {
//   console.log('done')
// })