
const fs = require('fs');
const { execSync } = require('child_process');

const RABBITMQ_SERVER = process.env.RABBITMQ_SERVER;
const videowikiGenerators = require('@videowiki/generators')
const rabbitmqService = require('./vendors/rabbitmq');
const { queues } = require('./constants');
const {
    EXPORT_ARTICLE_TRANSLATION,
    CONVERT_VIDEO_TO_ARTICLE_QUEUE,
    ARCHIVE_ARTICLE_TRANSLATION_AUDIOS,
    ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH,
    GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE,
    GENERATE_VIDEO_THUMBNAIL_QUEUE,
    BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE,
    BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH,
    UPDATE_ARTICLE_VIDEO_SPEED,
    UPDATE_ARTICLE_VIDEO_SPEED_FINISH,
    BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE,
    BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH,
    UPDATE_ARTICLE_SLIDE_VIDEO_SPEED,
    UPDATE_ARTICLE_SLIDE_VIDEO_SPEED_FINISH,
    UPDATE_ARTICLE_SLIDE_VIDEO_SLICE,
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
    const { server, app } = videowikiGenerators.serverGenerator({ uploadLimit: 50 });

    channel.on('error', (err) => {
        console.log('RABBITMQ ERROR', err)
        process.exit(1);
    })
    channel.on('close', () => {
        console.log('RABBITMQ CLOSE')
        process.exit(1);
    })

    videowikiGenerators.healthcheckRouteGenerator({ router: app, rabbitmqConnection: channel.connection });
    server.listen(4000);

    channel.prefetch(1)
    channel.assertQueue(EXPORT_ARTICLE_TRANSLATION, { durable: true });
    channel.assertQueue(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS, { durable: true })
    channel.assertQueue(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH, { durable: true })
    channel.assertQueue(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH, { durable: true })
    channel.assertQueue(GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, { durable: true })
    channel.assertQueue(GENERATE_VIDEO_THUMBNAIL_QUEUE, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH, { durable: true })
    channel.assertQueue(CONVERT_VIDEO_TO_ARTICLE_QUEUE, { durable: true });


    channel.assertQueue(UPDATE_ARTICLE_SLIDE_VIDEO_SLICE, { durable: true });
    channel.assertQueue(UPDATE_ARTICLE_VIDEO_SPEED, { durable: true })
    channel.assertQueue(UPDATE_ARTICLE_VIDEO_SPEED_FINISH, { durable: true })
    
    channel.assertQueue(UPDATE_ARTICLE_SLIDE_VIDEO_SPEED, { durable: true })
    channel.assertQueue(UPDATE_ARTICLE_SLIDE_VIDEO_SPEED_FINISH, { durable: true })

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

    // onBurnVideoSubtitlesAndSignLanguage
    setTimeout(() => {
        // channel.sendToQueue(UPDATE_ARTICLE_SLIDE_VIDEO_SLICE, new Buffer(JSON.stringify({ articleId: "5f20121d9ac15a001ffb1411", startTime: 1, endTime: 3, slidePosition: 0, subslidePosition: 0 })));
    }, 2000);
})
