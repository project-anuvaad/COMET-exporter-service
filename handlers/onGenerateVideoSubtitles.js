const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');

const queues = require('../constants').queues;
const utils = require('../utils');
const subtitlesUtils = require('../subtitles');

const {
    storageService,
} = require('../services');

const onGenerateVideoSubtitles = channel => msg => {
    const { id, langCode, langName, title, dir, subtitles  } = JSON.parse(msg.content.toString());
    console.log('got request to generate subtitles', id)
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    fs.mkdirSync(tmpDirPath);
    const subtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.srt`);
    subtitlesUtils.generateSubtitles(subtitles, subtitlePath)
    .then((subtitlePath) => {
        const subtitleName = `${dir || uuid()}/${langCode ||langName}_${title}-subtitles.srt`;
        return storageService.saveFile('subtitles', subtitleName, fs.createReadStream(subtitlePath))
    })
    .then((uploadRes) => {
        utils.cleanupDir(tmpDirPath);
        channel.ack(msg);
        channel.sendToQueue(queues.GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify({ id, url: uploadRes.url, master: true })), { persistent: true });
    })
    .catch(err => {
        utils.cleanupDir(tmpDirPath)
        console.log(err, ' error from catch');
        channel.ack(msg);
        channel.sendToQueue(queues.GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify({ id, status: 'failed' })), { persistent: true });
    })
}

module.exports = onGenerateVideoSubtitles;