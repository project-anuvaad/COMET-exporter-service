
const fs = require('fs');
const { execSync } = require('child_process');

const RABBITMQ_SERVER = process.env.RABBITMQ_SERVER;
const generators = require('@comet-anuvaad/generators')
const rabbitmqService = require('./vendors/rabbitmq');
const { queues } = require('./constants');
const {
    EXPORT_ARTICLE_TRANSLATION,
    CONVERT_VIDEO_TO_ARTICLE_QUEUE,
    ARCHIVE_ARTICLE_TRANSLATION_AUDIOS,
    GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE,
    GENERATE_VIDEO_THUMBNAIL_QUEUE,
    BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE,
    UPDATE_ARTICLE_VIDEO_SPEED,
    BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE,
    UPDATE_ARTICLE_SLIDE_VIDEO_SPEED,
    UPDATE_ARTICLE_SLIDE_VIDEO_SLICE,
    EXPORT_IMAGE_TRANSLATION_QUEUE,
} = queues;

const onConvertVideoToArticleHandler = require('./handlers/onConvertVideoToArticle');
const onExportArticleTranslationHandler = require('./handlers/onExportArticleTranslation');
const onARchiveArticleTranslationsAudios = require('./handlers/onArchiveTranslationAudios');
const onGenerateVideoSubtitles = require('./handlers/onGenerateVideoSubtitles');
const onGenerateVideoThumbnail = require('./handlers/onGenerateVideoThumbnail');
const onBurnVideoSubtitles = require('./handlers/onBurnVideoSubtitles');
const onUpdateArticleVideoSpeed = require('./handlers/onUpdateArticleVideoSpeed');
const onBurnVideoSubtitlesAndSignLanguage = require('./handlers/onBurnVideoSubtitlesAndSignLanguage');
const onUpdateArticleSlideVideoSpeed = require('./handlers/onUpdateArticleSlideVideoSpeed');
const onUpdateArticleSlideVideoSlice = require('./handlers/onUpdateArticleSlideVideoSlice');
const onExportImageTranslation = require('./handlers/onExportImageTranslation');

const REQUIRED_DIRS = ['./tmp'];

try {

    REQUIRED_DIRS.forEach((dir) => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir)
        } else {
            const r = execSync('rm -rf tmp/*')
            console.log('cleared tmp dir', r.toJSON())
        }
    })
} catch (e) {
    console.log(e);
}

let channel;
rabbitmqService.createChannel(RABBITMQ_SERVER, (err, ch) => {
    if (err) throw err;
    channel = ch;
    const { server, app } = generators.serverGenerator({ uploadLimit: 50 });

    channel.on('error', (err) => {
        console.log('RABBITMQ ERROR', err)
        process.exit(1);
    })
    channel.on('close', () => {
        console.log('RABBITMQ CLOSE')
        process.exit(1);
    })

    generators.healthcheckRouteGenerator({ router: app, rabbitmqConnection: channel.connection });
    server.listen(4000);

    channel.prefetch(1)
    Object.keys(queues).forEach(key => {
        channel.assertQueue(queues[key], { durable: true });
    })

    channel.consume(CONVERT_VIDEO_TO_ARTICLE_QUEUE, onConvertVideoToArticleHandler(channel), { noAck: false });
    channel.consume(EXPORT_ARTICLE_TRANSLATION, onExportArticleTranslationHandler(channel), { noAck: false });
    channel.consume(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS, onARchiveArticleTranslationsAudios(channel), { noAck: false });
    channel.consume(GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, onGenerateVideoSubtitles(channel), { noAck: false });
    channel.consume(GENERATE_VIDEO_THUMBNAIL_QUEUE, onGenerateVideoThumbnail(channel), { noAck: false });
    channel.consume(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, onBurnVideoSubtitles(channel), { noAck: false });
    channel.consume(UPDATE_ARTICLE_SLIDE_VIDEO_SLICE, onUpdateArticleSlideVideoSlice(channel), { noAck: false });
    channel.consume(UPDATE_ARTICLE_VIDEO_SPEED, onUpdateArticleVideoSpeed(channel), { noAck: false });
    channel.consume(UPDATE_ARTICLE_SLIDE_VIDEO_SPEED, onUpdateArticleSlideVideoSpeed(channel), { noAck: false });
    channel.consume(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE, onBurnVideoSubtitlesAndSignLanguage(channel), { noAck: false });

    channel.consume(EXPORT_IMAGE_TRANSLATION_QUEUE, onExportImageTranslation(channel), { noAck: false });
    // onBurnVideoSubtitlesAndSignLanguage
    setTimeout(() => {
        // channel.sendToQueue(UPDATE_ARTICLE_SLIDE_VIDEO_SLICE, new Buffer(JSON.stringify({ articleId: "5f20121d9ac15a001ffb1411", startTime: 1, endTime: 3, slidePosition: 0, subslidePosition: 0 })));
    }, 2000);
})
