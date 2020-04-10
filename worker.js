
const fs = require('fs');

const DB_CONNECTION_URL = process.env.DB_CONNECTION_URL;
const RABBITMQ_SERVER = process.env.RABBITMQ_SERVER;

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
    } = queues;

const onConvertVideoToArticleHandler = require('./handlers/onConvertVideoToArticle');
const onExportArticleTranslationHandler = require('./handlers/onExportArticleTranslation');
const onARchiveArticleTranslationsAudios = require('./handlers/onArchiveTranslationAudios');
const onGenerateVideoSubtitles = require('./handlers/onGenerateVideoSubtitles');
const onGenerateVideoThumbnail = require('./handlers/onGenerateVideoThumbnail');
const onBurnVideoSubtitles = require('./handlers/onBurnVideoSubtitles');
const onUpdateArticleVideoSpeed = require('./handlers/onUpdateArticleVideoSpeed');
const onBurnVideoSubtitlesAndSignLanguage = require('./handlers/onBurnVideoSubtitlesAndSignLanguage');
const REQUIRED_DIRS = ['./tmp'];

try {

    REQUIRED_DIRS.forEach((dir) => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir)
        } else {
            fs.unlinkSync(`${dir}/*`)
        }
    })
} catch(e) {
    console.log(e);
}

let channel;
rabbitmqService.createChannel(RABBITMQ_SERVER, (err, ch) => {
    if (err) throw err;
    channel = ch;
    channel.prefetch(1)
    channel.assertQueue(EXPORT_ARTICLE_TRANSLATION, { durable: true });
    channel.assertQueue(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS, { durable: true })
    channel.assertQueue(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH, { durable: true })
    channel.assertQueue(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS_FINISH, { durable: true })
    channel.assertQueue(GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, { durable: true })
    channel.assertQueue(GENERATE_VIDEO_THUMBNAIL_QUEUE, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_FINISH, { durable: true })
    channel.assertQueue(UPDATE_ARTICLE_VIDEO_SPEED, { durable: true })
    channel.assertQueue(UPDATE_ARTICLE_VIDEO_SPEED_FINISH, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE, { durable: true })
    channel.assertQueue(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE_FINISH, { durable: true })
    
    channel.consume(CONVERT_VIDEO_TO_ARTICLE_QUEUE, onConvertVideoToArticleHandler(channel), { noAck: false });
    channel.consume(EXPORT_ARTICLE_TRANSLATION, onExportArticleTranslationHandler(channel), { noAck: false });
    channel.consume(ARCHIVE_ARTICLE_TRANSLATION_AUDIOS, onARchiveArticleTranslationsAudios(channel), { noAck: false });
    channel.consume(GENERATE_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, onGenerateVideoSubtitles(channel), { noAck: false });
    channel.consume(GENERATE_VIDEO_THUMBNAIL_QUEUE, onGenerateVideoThumbnail(channel), { noAck: false });
    channel.consume(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE, onBurnVideoSubtitles(channel), { noAck: false });
    channel.consume(UPDATE_ARTICLE_VIDEO_SPEED, onUpdateArticleVideoSpeed(channel), { noAck: false });
    channel.consume(BURN_ARTICLE_TRANSLATION_VIDEO_SUBTITLE_AND_SIGNLANGUAGE, onBurnVideoSubtitlesAndSignLanguage(channel), { noAck: false });

    // onBurnVideoSubtitlesAndSignLanguage
    setTimeout(() => {
        // channel.sendToQueue(CONVERT_VIDEO_TO_ARTICLE_QUEUE, new Buffer(JSON.stringify({ videoId: "5d6d58e54be12b2d18b22b58", articleId: '5d6d5a1e03f9fa6cb96cc2ee' })));
    }, 2000);
})
