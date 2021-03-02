const { exec } = require('child_process');
const fs = require('fs');
const archiver = require('archiver');
// silence threashold in seconds
// slide duration threashold in seconds
const SLIDE_THREASHOLD = 10;
const async = require('async')


function downloadFile(url, targetPath) {
    return new Promise((resolve, reject) => {
        exec(`curl ${url} --output ${targetPath}`, (err) => {
            if (err) {
                return reject(err);
            }
            // ffmpeg emits warn messages on stderr, omit it and check if the file exists
            if (!fs.existsSync(targetPath)) {
                return reject(new Error('Failed to download file'));
            }
            return resolve(targetPath);
        })
    })
}

function getItemContent(item) {
    if (item.type === 'pronunciation') {
        return ` ${item.alternatives[0].content}`
    } else {
        return `${item.alternatives[0].content}`
    }
}

function getNearestStarTime(items) {
    return items.find((i) => i.startTime).startTime;
}

function divideSlidesIntoSubslides(slides) {
    const speakersSlides = [];
    // for each slide, we divide it into subslides based on the speaker label
    for (let index = 0; index < slides.length; index++) {
        const slide = slides[index];
        if (!slide.slideItems) {
            speakersSlides.push(slide);
            continue;
        }
        const subSlides = [];
        let itemsIndex = 0;
        let subSlide = {
            startTime: getNearestStarTime(slide.slideItems),
            content: getItemContent(slide.slideItems[itemsIndex]),
            speakerLabel: slide.slideItems[itemsIndex].speakerLabel,
        }
        // Go through all the items and divide collect them as subslides
        // based on the speaker label
        let nextItem = slide.slideItems[++itemsIndex];
        while (nextItem) {
            if (nextItem.speakerLabel === subSlide.speakerLabel) {
                subSlide.content += getItemContent(nextItem);

                if (!subSlide.startTime && nextItem.startTime) {
                    subSlide.startTime = nextItem.startTime;
                }

                if (nextItem.endTime) {
                    subSlide.endTime = nextItem.endTime;
                }
            } else {
                subSlides.push({ ...subSlide, content: subSlide.content.trim(), duration: (subSlide.endTime - subSlide.startTime) * 1000 });
                subSlide = {
                    startTime: nextItem.startTime || 0,
                    endTime: nextItem.endTime,
                    content: getItemContent(nextItem),
                    speakerLabel: nextItem.speakerLabel,
                }
            }
            nextItem = slide.slideItems[++itemsIndex];
        }
        if (subSlide.startTime !== subSlide.endTime) {
            subSlides.push({ ...subSlide, content: subSlide.content.trim(), duration: (subSlide.endTime - subSlide.startTime) * 1000 });
        }
        speakersSlides.push(subSlides)
    }
    return speakersSlides;
}

function formatTranscribedSlidesToCut(slides) {
    let finalSlides = [];
    const speakersSlides = [];
    const items = slides
        .reduce((acc, slide) => acc.concat(slide.items.map(item => ({ ...item, speakerLabel: slide.speakerLabel, startTime: parseFloat(item.start_time), endTime: parseFloat(item.end_time) }))), []);

    for (let index = 0; index < items.length; index++) {
        let item = items[index];
        let startTime = item.startTime || 0;
        let endTime = item.endTime || startTime;
        let slideContent = getItemContent(item);
        let nextItem = items[++index];
        let slideItems = [item];
        let prevItem = item;
        while (nextItem && !((endTime - startTime >= SLIDE_THREASHOLD && getItemContent(prevItem).trim() === '.'))) {
            prevItem = nextItem;
            if (nextItem.endTime) {
                endTime = nextItem.endTime;
            }
            slideContent += getItemContent(nextItem);
            slideItems.push(nextItem);
            nextItem = items[++index];
        }
        // speakersSlides.push({ slideItems, slideContent, startTime, endTime: slideItems.reduce((acc, item) => item.endTime && item.startTime ? acc + (item.endTime - item.startTime) : acc, startTime) })
        speakersSlides.push({ slideItems, content: slideContent, startTime, endTime: slideItems.reduce((acc, item) => item.endTime && item.startTime ? item.endTime : acc, startTime) })
        index--;
    }
    finalSlides = divideSlidesIntoSubslides(speakersSlides);
    return finalSlides;
}

function getSpeakerNumberFromLabel(speakerLabel) {
    return parseInt(speakerLabel.replace('spk_', ''))
}

function formatSlidesToSlideSpeakerSchema(slides) {
    const formattedSlides = [];
    slides.forEach((subslides, subslidesIndex) => {
        subslides.forEach((slide) => {
            slide.text = slide.content;
            delete slide.content;
            slide.audio = '';
            slide.media = [];
            if (slide.speakerLabel) {
                slide.speakerProfile = {
                    speakerNumber: getSpeakerNumberFromLabel(slide.speakerLabel),
                    speakerGender: 'male',
                }
            }
        })
        formattedSlides.push({
            content: subslides,
            position: subslidesIndex,
            convertStatus: 'done',
        })
    })
    return formattedSlides;
}

function getSpeakersFromSlides(slides) {
    const speakers = [];
    slides.forEach((slide) => {
        slide.content.forEach((subslide) => {
            if (speakers.map(s => s.speakerNumber).indexOf(subslide.speakerProfile.speakerNumber) === -1) {
                speakers.push(subslide.speakerProfile);
            }
        })
    })
    return speakers;
}

// function formatTranscribedSlidesToCut(slides, videoDuration) {
//     let finalSlides = [];
//     const speakersSlides = [];
//     // Collect the same speaker's consicutive slides into one;
//     for (let index = 0; index < slides.length; index++) {
//         const slide = slides[index];
//         let slideContent = slide.content;
//         let subSlides = [slide];
//         let slideStartTime = slide.startTime;
//         let slideEndTime = slide.endTime;
//         let items = [].concat(slide.items);
//         let nextSlide = slides[++index];
//         let totalTime = 0;
//         while (nextSlide && nextSlide.speakerLabel === slide.speakerLabel) {
//             slideContent += ` ${nextSlide.content}`;
//             subSlides.push(nextSlide);
//             slideEndTime = nextSlide.endTime;
//             items = items.concat(nextSlide.items);
//             nextSlide = slides[++index];
//         }
//         index--;
//         const speakerSlideData = {
//             speakerLabel: slide.speakerLabel,
//             startTime: slideStartTime,
//             endTime: slideEndTime,
//             content: slideContent,
//             // subSlides,
//             items,
//         };
//         // If the slide time is greater than the threashold
//         // divide it into sub slides splitted by dots
//         if (slideEndTime - slideStartTime >= SLIDE_THREASHOLD) {
//             divideSpeakerSlidesByDot(speakerSlideData).forEach((s) => speakersSlides.push(s));
//         } else {
//             speakersSlides.push(speakerSlideData);
//         }

//     }
//     finalSlides = handleSlidesSilence(speakersSlides, videoDuration);
//     return finalSlides;
// }

function getRemoteFileDuration(url) {
    return new Promise((resolve, reject) => {
        exec(`ffprobe -i ${url} -show_entries format=duration -v quiet -of csv="p=0"`, (err, stdout, stderr) => {
            if (err) {
                console.log(stderr);
                return reject(err);
            }
            if (stderr) {
                return reject(stderr);
            }
            const duration = parseFloat(stdout.replace('\\n', ''));
            resolve(duration);
        })
    })
}

function formatCutTime(seconds) {
    let hours = Math.floor(seconds / 3600);
    let minutes = Math.floor((seconds - (hours * 3600)) / 60);
    seconds = seconds - (hours * 3600) - (minutes * 60);
    if (hours < 10) { hours = "0" + hours; }
    if (minutes < 10) { minutes = "0" + minutes; }
    if (seconds < 10) { seconds = "0" + seconds; }
    let time = hours + ':' + minutes + ':' + seconds;
    console.log(parseFloat(seconds) , seconds)
    if ((parseFloat(seconds) === parseFloat(`0${seconds}`) || parseFloat(seconds) === 0) && String(seconds).indexOf('.') === -1) {
        time += '.000';
    }
    if (time.length < 12) {
        for (let i = 0; i < Array(12 - time.length).length; i++) {
            time += '0';
        }
    }
    return time.substr(0, 12);
}

function getFileExtension(url) {
    return url.split('.').pop().toLowerCase();
}

function cleanupFiles(files) {
    files.forEach((file) => {
        fs.unlink(file, () => { });
    })
}

function cleanupDir(dir){
    exec(`rm -rf ${dir}`, (err) => {
        console.log('deleted directory', dir, err);
    })
}

/*
    files: { path: 'path/to/file', name: 'File1.mp3' }
    archiveType: zip|tar
    archivePath: 'path/to/finalArchiveFolder.zip'
*/

function archiveFiles(files, archiveType, archivePath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(archivePath);
        const archive = archiver(archiveType, {
            zlib: { level: 9 } // Sets the compression level.
        });
        output.on('finish', function() {
            console.log('Data has been drained');
            resolve(archivePath);
        });
           
        archive.on('warning', function(err) {
            console.log('Warning', err);
        });
        
        archive.on('error', function(err) {
            reject(err);
        });

        // pipe archive data to the file
        archive.pipe(output);
        files.forEach((file) => {
            archive.append(fs.createReadStream(file.path), { name: file.name });
        })
        archive.finalize();

    })
}

function formatSlidesToSubslides(slides) {
    return slides.reduce((acc, s) => s.content && s.content.length > 0 ? acc.concat(s.content.map((ss) => ({ ...ss, slidePosition: s.position, subslidePosition: ss.position }))) : acc, []).sort((a, b) => a.startTime - b.startTime)
}

function getFilesDuration(urls, callback) {
    const getFilesDurationFuncArray = [];
    urls.forEach(url => {
        function getFileDuration(cb) {
            getRemoteFileDuration(url)
            .then((duration) => cb(null, duration))
            .catch(err => callback(err))
        }

        getFilesDurationFuncArray.push(getFileDuration);
    })

    async.parallelLimit(getFilesDurationFuncArray, 3, (err, results) => {
        if (err) {
            return callback(err);
        }
        if (!results || results.length === 0) return callback(null, 0);

        const duration = results.reduce((acc, d) => acc + parseFloat(d), 0);
        return callback(null, duration);
    })
}

module.exports = {
    formatCutTime,
    getRemoteFileDuration,
    getFilesDuration,
    formatTranscribedSlidesToCut,
    downloadFile,
    getFileExtension,
    getSpeakersFromSlides,
    formatSlidesToSlideSpeakerSchema,
    cleanupFiles,
    cleanupDir,
    archiveFiles,
    formatSlidesToSubslides,
}