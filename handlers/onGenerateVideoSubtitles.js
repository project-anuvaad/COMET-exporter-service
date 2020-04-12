const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');


const queues = require('../constants').queues;
const utils = require('../utils');
const subtitles = require('../subtitles');

const {
    translationExportService,
    storageService,
    subtitlesService,
    articleService,
} = require('../services');

const onGenerateVideoSubtitles = channel => msg => {
    const { translationExportId } = JSON.parse(msg.content.toString());
    console.log('got request to generate subtitles', translationExportId)
    let article;
    let translationExport;
    const tmpDirName = uuid();
    let subtitlesDoc
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    fs.mkdirSync(tmpDirPath);
    translationExportService.findById(translationExportId)
        .then(te => {
            if (!te) throw new Error('Invalid translation export id');
            translationExport = te;
            return articleService.findById(te.article)    
        })
        .then(a => {
            translationExport.article = a;
            article = a;
            return Promise.resolve(translationExport);
        })
        // Fetch subtitles doc
        .then(() => subtitlesService.find({ article: article._id })) 
        .then((subtitlesDocs) => {
            if (!subtitlesDocs || subtitlesDocs.length === 0) throw new Error('This translation has no generate subtitles yet');
            subtitlesDoc = subtitlesDocs[0].toObject();
            // Generate subtitles
            // const allSubslides = article.slides.reduce((acc, s) => acc.concat(s.content), []).filter((s) => s.text && s.text.trim()).sort((a, b) => a.startTime - b.startTime).map((s, index) => ({ ...s, position: index }));
            const subtitlePath = path.join(tmpDirPath, `subtitles-${uuid()}.srt`);
            return subtitles.generateSubtitles(subtitlesDoc.subtitles, subtitlePath)
        })
        .then((subtitlePath) => {
            return new Promise((resolve, reject) => {
                const subtitleName = `${translationExport.dir || uuid()}/${article.langCode || article.langName}_${article.title}-subtitles.srt`;
                storageService.saveFile('subtitles', subtitleName, fs.createReadStream(subtitlePath))
                .then((uploadRes) => {
                    return translationExportService.updateById(translationExportId, { subtitleUrl: uploadRes.url, subtitleProgress: 100 });
                })
                .then(() => {
                    console.log('done uploading')
                    return resolve();
                })
                .catch((err) => {
                    // If that fails that's fine, proceed to videos
                    console.log('error uploading subtitle audios', err);
                    return reject();
                })
            })
        })
        .then(() => {
            utils.cleanupDir(tmpDirPath);
            channel.ack(msg);
            channel.sendToQueue(queues.GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
        })
        .catch(err => {
            utils.cleanupDir(tmpDirPath)
            console.log(err, ' error from catch');
            channel.ack(msg);
            translationExportService.updateById(translationExportId, { subtitledVideoProgress: 0 }).then(() => { });
        })
}

// function updateTranslationExportSubtitledVideoProgress(translationExportId, subtitleProgress) {
//     translationExportService.update({ _id: translationExportId }, { subtitleProgress })
//         .then((r) => {
//             console.log('progress', subtitleProgress)
//             translationExportService.findById(subtitleProgress)
//                 .then((exporitem) => {
//                     console.log(exporitem)
//                 })
//         })
//         .catch(err => {
//             console.log('error updating progres', err);
//         })
// }


module.exports = onGenerateVideoSubtitles;