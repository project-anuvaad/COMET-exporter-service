const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs');

const {
    storageService,
    translationExportService,
    articleService,
} = require('../services');

const async = require('async');
const queues = require('../constants').queues;
const utils = require('../utils');
const converter = require('../converter');


const onArchiveTranslationAudios = channel => msg => {
    const { translationExportId } = JSON.parse(msg.content.toString());
    console.log('got request to export', translationExportId)
    let article;
    const tmpDirName = uuid();
    const tmpDirPath = path.join(__dirname, `../tmp/${tmpDirName}`);
    fs.mkdirSync(tmpDirPath);
    let translationExport;
    translationExportService.findById(translationExportId)
        .then((te) => {
            translationExport = te;
            return articleService.findById(translationExport.article)
        })
        .then(article => {
            translationExport.article = article;
            return Promise.resolve(translationExport);
        })
        .then((translationExport) => {
            return new Promise((resolve, reject) => {
                // Generate audios zip file
                if (!translationExport) return reject(new Error('Invalid translation export id'));
                article = translationExport.toObject().article;
                console.log('geenrating archive')
                const allSubslides = article.slides.reduce((acc, s) => acc.concat(s.content), []).filter((s) => s.audio).sort((a, b) => a.startTime - b.startTime).map((s, index) => ({ ...s, position: index }));
                // Download audios locally
                const downloadAudioFuncArray = [];
                allSubslides.forEach(subslide => {
                    downloadAudioFuncArray.push(cb => {
                        const filePath = path.join(tmpDirPath, `audio-${uuid()}.${subslide.audio.split('.').pop()}`);

                        utils.downloadFile(subslide.audio, filePath)
                            .then(() => {
                                subslide.audioPath = filePath;
                                return cb();
                            })
                            .catch(cb);
                    })
                });
                async.parallelLimit(downloadAudioFuncArray, 3, (err) => {
                    if (err) return reject(err);
                    updateTranslationExportAudioArchiveProgress(translationExportId, 50)
                    return resolve(allSubslides);
                })
            })

        })
        // Convert audios to mp3
        .then((allSubslides) => {
            return new Promise((resolve, reject) => {
                const convertAudioFuncArray = [];
                allSubslides.forEach((subslide) => {
                    console.log('file extension', utils.getFileExtension(subslide.audioPath), utils.getFileExtension(subslide.audioPath) !== 'mp3')
                    if (utils.getFileExtension(subslide.audioPath) !== 'mp3') {
                        convertAudioFuncArray.push((cb) => {
                            converter.convertToMp3(subslide.audioPath)
                            .then((newPath) => {
                                subslide.audioPath = newPath;
                                console.log('new path is', subslide.audioPath)
                                return cb();
                            })
                            .catch((err) => {
                                console.log('error converting to mp3', err);
                                return cb();
                            })
                        })
                    }
                })
                async.parallelLimit(convertAudioFuncArray, 2, (err) => {
                    if (err) {
                        console.log('error converting all to mp3', err);
                    }
                    return resolve(allSubslides);
                })
            })
        })
        .then((allSubslides) => {
            return new Promise((resolve, reject) => {

                const audios = allSubslides.map((subslide, index) => ({ path: subslide.audioPath, name: subslide.name ? `${subslide.position}-${subslide.name}.${utils.getFileExtension(subslide.audioPath)}` : `${article.langCode}_${article.title}_audio_${subslide.position}.${utils.getFileExtension(subslide.audioPath)}` }));
                const archivePath = path.join(tmpDirPath, `${article.langCode}-${article.title}-audios-${uuid()}.zip`);
                console.log(archivePath, audios)
                utils.archiveFiles(audios, 'zip', archivePath)
                .then(() => {
                    // Upload archive
                    console.log('uploading audios')
                    updateTranslationExportAudioArchiveProgress(translationExportId, 70)
                    return storageService.saveFile('translationAudios', archivePath.split('/').pop(), fs.createReadStream(archivePath));
                })
                .then((uploadRes) => {
                    return translationExportService.updateById(translationExportId, { audiosArchiveUrl: uploadRes.url, audiosArchiveProgress: 100 });
                })
                .then(() => {
                    console.log('done archiving')
                    return resolve();
                })
                .catch((err) => {
                    // If that fails that's fine, proceed to videos
                    console.log('error archiving audios', err);
                    return resolve();
                })
            })
        })
        .then(() => {
            utils.cleanupDir(path.join(__dirname, `../${tmpDirName}`));
            channel.ack(msg);
            channel.sendToQueue(queues.ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH, new Buffer(JSON.stringify({ translationExportId })), { persistent: true });
        })
        .catch(err => {
            utils.cleanupDir(path.join(__dirname, `../${tmpDirName}`))
            console.log(err, ' error from catch');
            channel.ack(msg);
            translationExportService.updateById(translationExportId, { audiosArchiveProgress: 0 }).then(() => { });
        })
}

function updateTranslationExportAudioArchiveProgress(translationExportId, audiosArchiveProgress) {
    translationExportService.update({_id: translationExportId}, { audiosArchiveProgress })
        .then((r) => {
            console.log('progress',translationExportId, audiosArchiveProgress, r)
            translationExportService.findById(translationExportId,)
            .then((exporitem) => {
                console.log(exporitem)
            })
        })
        .catch(err => {
            console.log('error updating progres', err);
        })
}


module.exports = onArchiveTranslationAudios;