// TODO: Schedule words using a periodic setInterval/requestAnimationFrame timer
//  Schedule multiple words in advance as one block, using animation-delay, so
//   that we can go without running for like ~1000ms without glitching.
//  Don't schedule too much since that stops us from adjusting scroll speed.


var characterDuration = 0.032;
var whitespaceDuration = 0.065;
var successiveWhitespaceDuration = 0.03;
var fastDurationMultiplier = 0.55;

var characterDelays = {
    ",": 0.15,
    ".": 0.35,
    "?": 0.4
};

var animationDurations = {
    "fade-in": 0.200,
    "descend-fade-in": 0.190,
    "drop-in-fade": 0.190,
    "rise-fade-in": 0.190,
    "blurry-fade-in": 0.410
};

var sectionDelay = 2;

var maxRunQuicklyCount = 3;
var maxPendingCleanups = 4;
var periodicCleanupIntervalMs = 2500;

var instantBoundaryHeight = 0;
var veryFastBoundaryHeight = 40;
var fastBoundaryPercentage = 25;
var bottomBoundaryHeight = 140;
var pauseIndicatorScrollMargin = 220;

// The fuck, chrome?
var windowScrollTop = 0;
var onResizeTimeout = null;

var fontsAreLoaded = false;
var pausedAtY = null;

var animationQueue = null;

function DelayProvider () {
    this.runImmediatelyQueue = [];
    this.runImmediatelyPending = false;

    this.runQuicklyQueue = [];
    this.runQuicklyPending = false;

    this.periodicCleanupQueue = [];
    this.periodicCleanupPending = false;

    this.boundStepRunImmediately = this.stepRunImmediately.bind(this);
    this.boundStepRunQuickly = this.stepRunQuickly.bind(this);
    this.boundStepPeriodicCleanup = this.stepPeriodicCleanup.bind(this);
};

DelayProvider.prototype.runImmediately = function (callback) {
    this.runImmediatelyQueue.push(callback);

    if (!this.runImmediatelyPending) {
        this.runImmediatelyPending = true;
        setTimeout(this.boundStepRunImmediately, 0);
    }
};

DelayProvider.prototype.runQuickly = function (callback) {
    this.runQuicklyQueue.push(callback);

    if (!this.runQuicklyPending) {
        this.runQuicklyPending = true;
        setTimeout(this.boundStepRunQuickly, 1);
    }
};

DelayProvider.prototype.cleanupEventually = function (callback) {
    this.periodicCleanupQueue.push(callback);

    if (this.periodicCleanupQueue.length > maxPendingCleanups) {
        this.stepPeriodicCleanup();
    } else if (!this.periodicCleanupPending) {
        this.periodicCleanupPending = true;
        setTimeout(this.boundStepPeriodicCleanup, periodicCleanupIntervalMs);
    }
};

DelayProvider.prototype.runAfterDelay = function (callback, delayMs) {
    if (delayMs <= 2)
        this.runQuickly(callback);
    else
        setTimeout(callback, delayMs);
};

DelayProvider.prototype.stepPeriodicCleanup = function () {
    this.periodicCleanupPending = false;

    var items = this.periodicCleanupQueue;

    while (items.length > 0) {
        var toRun = items.length;
        for (var i = 0; i < toRun; i++) {
            items[i]();
        }

        items.splice(0, toRun);
    }
};

DelayProvider.prototype.stepRunImmediately = function () {
    this.runImmediatelyPending = false;

    var items = this.runImmediatelyQueue;

    while (items.length > 0) {
        var toRun = items.length;
        for (var i = 0; i < toRun; i++) {
            items[i]();
        }

        items.splice(0, toRun);
    }
};

DelayProvider.prototype.stepRunQuickly = function () {
    this.runQuicklyPending = false;

    var totalToRun = maxRunQuicklyCount;
    var items = this.runQuicklyQueue;

    while ((items.length > 0) && (totalToRun > 0)) {
        var toRun = Math.min(items.length, totalToRun);
        for (var i = 0; i < toRun; i++) {
            items[i]();
        }

        items.splice(0, toRun);
        totalToRun -= toRun;
    }

    if (items.length > 0) {
        this.runQuicklyPending = true;
        setTimeout(this.boundStepRunQuickly, 0);
    }
};


function AnimationQueueWordEntry (nodes, animationName, characterPause) {
    if (!Array.isArray(nodes))
        throw new Error("First argument must be an array of nodes");

    this.nodes = nodes;
    this.rectangle = null;
    this.rectangleYOffset = 0;
    this.animationName = animationName;
    this.characterPause = characterPause;
    this.extraDelay = 0;
    this.isActive = false;
    this.isWhitespace = false;
    this.wordNode = null;

    this.boundCleanup = this.cleanup.bind(this);
};

AnimationQueueWordEntry.prototype.measure = function () {
    var firstNode = this.nodes[0];

    if (firstNode.nodeName.toLowerCase() === "whitespace") {
        this.wordNode = firstNode;
        this.isWhitespace = true;
    } else {
        this.wordNode = this.nodes[0].parentNode;
        this.isWhitespace = false;

        if (this.wordNode.nodeName.toLowerCase() !== "word")
            throw new Error("non-whitespace nodes not contained inside a word node");
    }

    this.rectangle = this.wordNode.getBoundingClientRect();
    this.rectangleYOffset = windowScrollTop;
};

AnimationQueueWordEntry.prototype.applyWordSize = function () {
    // No explicit sizing for whitespace. It's not a block anyway.
    if (this.wordNode.nodeName.toLowerCase() === "whitespace")
        return;

    this.wordNode.style.width = this.rectangle.width.toFixed(4) + "px";
    this.wordNode.style.height = this.rectangle.height.toFixed(4) + "px";
};

AnimationQueueWordEntry.prototype.cleanup = function () {
    // This is necessary in firefox because otherwise our nodes remain layers forever.
    // SADLY in chrome this forces layout. UGH.

    if (this.animationName === null)
        return;

    // strip animation styles
    // slower, more complicated
    for (var i = 0, l = this.nodes.length; i < l; i++) {
        var node = this.nodes[i];

        node.style.webkitAnimationName = node.style.animationName = "";
        node.style.webkitAnimationFillMode = node.style.animationFillMode = "";
        node.style.webkitAnimationDelay = node.style.animationDelay = "";
        node.style.webkitAnimationDuration = node.style.animationDuration = "";
    }

    /*
    // Replace characters with a single text node.
    // Simplifies the dom (faster layout)
    // Makes layout glitch because this causes kerning and ligatures to turn on. Ugh.
    this.wordNode.textContent = this.wordNode.textContent;
    */
};

AnimationQueueWordEntry.prototype.activate = function (delayProvider, onComplete) {
    if (this.isActive)
        throw new Error("Already active");

    var completed = false;
    var self = this;

    var lastNode = self.nodes[self.nodes.length - 1];

    function fireOnComplete () {
        if (completed)
            return;

        completed = true;
        onComplete(self);
    }

    // !@&%(*!@)

    var instantBoundary = windowScrollTop + instantBoundaryHeight;
    var veryFastBoundary = windowScrollTop + veryFastBoundaryHeight;
    var fastBoundary = windowScrollTop + (windowHeight * fastBoundaryPercentage / 100);
    var suspendBoundary = (windowScrollTop + windowHeight) - bottomBoundaryHeight;

    var top = self.rectangle.top + self.rectangleYOffset;
    var completeInstantly = top <= instantBoundary;
    var completeVeryFast = top <= veryFastBoundary;
    var completeFast = top <= fastBoundary;
    // FIXME: use self.rectangle.bottom? Seems too aggressive.
    var suspend = top >= suspendBoundary;

    var characterPause = self.characterPause;
    if (completeFast)
        characterPause *= fastDurationMultiplier;

    pausedAtY = null;
    if (suspend) {
        pausedAtY = self.rectangle.bottom + self.rectangleYOffset;

        return false;
    } else if (completeInstantly || completeVeryFast) {
        function reveal () {
            for (var i = 0, l = self.nodes.length; i < l; i++) {
                var node = self.nodes[i];
                node.removeAttribute("class");
            }

            fireOnComplete();
        }

        if (completeInstantly)
            delayProvider.runImmediately(reveal);
        else
            delayProvider.runQuickly(reveal);

        return true;
    }

    var result = false;

    if ((self.animationName !== null) && !this.isWhitespace) {
        var localDelay = 0;

        for (var i = 0, l = self.nodes.length; i < l; i++) {
            var node = self.nodes[i];
            var localDuration = animationDurations[self.animationName];
            if (completeFast)
                localDuration *= fastDurationMultiplier;

            node.removeAttribute("class");
            node.style.webkitAnimationFillMode = node.style.animationFillMode = "both";
            node.style.webkitAnimationDelay = node.style.animationDelay = localDelay.toFixed(4) + "s";
            node.style.webkitAnimationDuration = node.style.animationDuration = localDuration.toFixed(4) + "s";
            node.style.webkitAnimationName = node.style.animationName = self.animationName;

            var characterDelay = characterDelays[node.textContent];
            if (typeof (characterDelay) !== "number")
                characterDelay = 0;
            if (completeFast)
                characterDelay *= fastDurationMultiplier;

            localDelay += characterPause + characterDelay;
        }

        var cleanupCallback = function () {
            delayProvider.cleanupEventually(self.boundCleanup);
        };

        lastNode.addEventListener("animationend", cleanupCallback, false);
        // fuck chrome
        lastNode.addEventListener("webkitAnimationEnd", cleanupCallback, false);

        result = true;
    }

    if (
        (typeof (self.characterPause) === "number") ||
        (self.extraDelay > 0)
    ) {
        var delayMs = 0;

        if (typeof (self.characterPause) === "number")
            delayMs += (characterPause * self.nodes.length) * 1000;

        if (completeFast)
            delayMs += self.extraDelay * fastDurationMultiplier * 1000;
        else
            delayMs += self.extraDelay * 1000;

        delayProvider.runAfterDelay(fireOnComplete, delayMs);
        result = true;
    }

    if (!result)
        throw new Error("Invalid animation queue entry");

    this.isActive = true;
    return result;
};


function AnimationQueueSentenceEntry () {
};


function AnimationQueue () {
    this.queue = [];
    this.position = 0;
    this.onComplete = null;
    this.delayProvider = new DelayProvider();
    this.isInvalid = true;

    this.boundStep = this.step.bind(this);
    this.boundStepComplete = this.stepComplete.bind(this);
    this.boundMeasure = this.measure.bind(this);
};

AnimationQueue.prototype.enqueueWord = function (node, animationName, characterPause) {
    var result = new AnimationQueueWordEntry(node, animationName, characterPause);
    this.queue.push(result);
    this.isInvalid = true;
    return result;
};

AnimationQueue.prototype.stepComplete = function () {
    this.position += 1;
    this.step();
};

AnimationQueue.prototype.step = function () {
    if (this.position >= this.queue.length) {
        if (this.onComplete)
            this.onComplete(this);

        return;
    }

    // cache these.
    if (typeof (window.scrollY) === "number")
        windowScrollTop = window.scrollY;
    else
        windowScrollTop = window.pageYOffset;

    windowHeight = window.innerHeight;

    entry = this.queue[this.position];

    if (
        this.isInvalid ||
        !entry.activate(this.delayProvider, this.boundStepComplete)
    ) {
        window.setTimeout(this.boundStep, 100);
    }

    updatePauseIndicator();
};

AnimationQueue.prototype.measure = function () {
    // cache these.
    if (typeof (window.scrollY) === "number")
        windowScrollTop = window.scrollY;
    else
        windowScrollTop = window.pageYOffset;

    windowHeight = window.innerHeight;

    // Measure all the characters/words
    for (var i = 0, l = this.queue.length; i < l; i++) {
        this.queue[i].measure();
    }

    // Apply fixed sizes to all the words now.
    for (var i = 0, l = this.queue.length; i < l; i++) {
        this.queue[i].applyWordSize();
    }

    this.isInvalid = false;
};

AnimationQueue.prototype.start = function () {
    if (this.isInvalid)
        throw new Error("measure() must be called first. Queue invalid.");

    this.step();
};


function onLoad () {
    animationQueue = new AnimationQueue();

    window.addEventListener("resize", onResize, false);
    onResize();

    // Force display: none to suppress layout
    document.querySelector("story").className = "loading";

    loadFonts(function () {
        prepareStory(beginStory)
    });
};

function loadFonts (onComplete) {
    var completed = false;

    WebFont.load({
        google: {
            families: ['Lato:400,300italic,300,400italic,700,700italic:latin']
        },
        loading: function () {
            console.log("Fonts loading");
        },
        active: function () {
            console.log("Fonts loaded");

            if (!completed) {
                fontsAreLoaded = true;
                completed = true;
                onComplete();
            }
        },
        inactive: function () {
            console.log("Could not load fonts");
            
            if (!completed) {
                fontsAreLoaded = true;
                completed = true;
                onComplete();
            }
        }
    });
};

function prepareStory (onComplete) {
    console.log("Preparing story layout");
    var sections = document.querySelectorAll("section");

    var i = 0, l = sections.length;

    function step () {
        if (i >= l) {
            finished();
            return;
        }

        console.log("Laying out section " + i);

        var section = sections[i];
        var pages = section.querySelectorAll("page");

        for (var i2 = 0, l2 = pages.length; i2 < l2; i2++) {
            var page = pages[i2];
            var children = page.children;

            for (var i3 = 0, l3 = children.length; i3 < l3; i3++) {
                var elt = children[i3];
                if (elt.nodeType === Node.TEXT_NODE)
                    continue;

                spanifyCharacters(elt, animationQueue);

                trimWhitespace(elt);
            }
        }

        // HACK: Insert delay at end of section
        var lastEntry = animationQueue.queue[animationQueue.queue.length - 1];
        if (lastEntry) {
            lastEntry.extraDelay += sectionDelay;
        }

        i += 1;

        setTimeout(step, 1);
    };

    function finished () {
        console.log("Story layout prepared");

        // display: block, opacity 0 so we can fade in
        document.querySelector("story").className = "invisible";

        setTimeout(onComplete, 100);
    };

    step();
};

function beginStory () {
    document.querySelector("story").className = "";
    document.querySelector("loadingindicator").className = "invisible";

    animationQueue.measure();
    animationQueue.start();
};

function updatePauseIndicator () {
    var indicator = document.querySelector("pauseindicator");
    var indicatorVisible = false;

    if (pausedAtY !== null) {
        var boundaryY = (pausedAtY - pauseIndicatorScrollMargin);
        indicatorVisible = (windowScrollTop + windowHeight) >= boundaryY;
    }

    var expectedClassName = indicatorVisible
        ? "paused"
        : "unpaused";

    if (indicator.className !== expectedClassName)
        indicator.className = expectedClassName;
};

function onResize () {
    if (onResizeTimeout !== null) {
        clearTimeout(onResizeTimeout);
        onResizeTimeout = null;
    }

    windowHeight = window.innerHeight;

    animationQueue.isInvalid = true;

    if (fontsAreLoaded) {
        onResizeTimeout = setTimeout(animationQueue.boundMeasure, 250);
    }
};

function enumerateTextNodes (e, output) {
    if (!output)
        output = [];

    for (var c = e.childNodes, i = 0, l = c.length; i < l; i++) {
        var child = c[i];

        if (child.nodeType === Node.TEXT_NODE) {
            if (child.nodeValue.length === 0)
                continue;
            else if (
                (
                    (i === 0) || 
                    (i === (l - 1))
                ) &&
                (child.nodeValue.trim().length === 0)
            ) {
                // Don't generate leading/trailing whitespace for paragraphs;
                //  just whitespace between sentences.
                // Native browser layout seems to do this anyway.
                continue;
            }

            output.push(child);
        } else {
            enumerateTextNodes(child, output);
        }
    }

    return output;
};

function trimWhitespace (e) {
    if (!(e.firstChild))
        return;

    if (e.firstChild.className === "whitespace") {
        e.removeChild(e.firstChild);
    }

    if (e.lastChild.className === "whitespace") {
        e.removeChild(e.lastChild);
    }
};

function spanifyCharacters (e, animationQueue) {
    var textNodes = enumerateTextNodes(e);
    var lastPause = null, wordAnimation = null;

    var isFirstTextNode = true;

    for (var i = 0, l = textNodes.length; i < l; i++) {
        var textNode = textNodes[i];

        var f = document.createDocumentFragment();
        var currentWord = null;
        var currentWordNodes = null;
        var currentWhitespace = null;

        var text = textNode.nodeValue;

        for (var l2 = text.length, i2 = 0; i2 < l2; i2++) {
            var ch = text[i2];

            if (ch.trim().length === 0) {
                if (currentWord) {
                    f.appendChild(currentWord);
                    currentWord = null;
                    currentWordNodes = null;
                }

                if (currentWhitespace === null) {
                    currentWhitespace = document.createElement("whitespace");
                    currentWhitespace.textContent = ch;

                    f.appendChild(currentWhitespace);
                    lastPause = animationQueue.enqueueWord(
                        [currentWhitespace], null, whitespaceDuration
                    );

                } else {

                    currentWhitespace.textContent += ch;
                    lastPause.extraDelay += successiveWhitespaceDuration;
                }

            } else {

                currentWhitespace = null;
                lastPause = null;

                var span = document.createElement("character");
                span.textContent = ch;

                if (currentWord === null) {
                    currentWord = document.createElement("word");
                    currentWordNodes = [];

                    // HACK: Walk up to 3 nodes to find animation name
                    var animationName = textNode.parentNode.getAttribute("data-animationName");
                    try {
                        if (!animationName)
                            animationName = textNode.parentNode.parentNode.getAttribute("data-animationName");
                        if (!animationName)
                            animationName = textNode.parentNode.parentNode.parentNode.getAttribute("data-animationName");
                    } catch (exc) {
                    }

                    if (!animationName)
                        animationName = "fade-in";

                    wordAnimation = animationQueue.enqueueWord(
                        currentWordNodes, animationName, characterDuration
                    );
                }

                span.className = "invisible";
                currentWord.appendChild(span);
                currentWordNodes.push(span);

                var characterDelay = characterDelays[ch];
                if (typeof (characterDelay) === "number") {
                    wordAnimation.extraDelay += characterDelay;
                }
            }
        }

        if (currentWord)
            f.appendChild(currentWord);

        if (textNode === textNode.parentNode.lastChild) {
            // We're on the last text node of a container.

            var annotationContainer = textNode.parentNode;

            var userDelay = annotationContainer.getAttribute("data-advanceDelay");

            if (userDelay !== null) {
                userDelay = parseFloat(userDelay);

                if (lastPause !== null)
                    lastPause.extraDelay += userDelay;
                else if (wordAnimation != null)
                    wordAnimation.extraDelay += userDelay;

                console.log("Applying user delay of", userDelay, "to", textNode);
            }
        }

        textNode.parentNode.replaceChild(f, textNode);

        isFirstTextNode = false;
    }
};