var characterDuration = 0.0325;
var whitespaceDuration = 0.07;
var successiveWhitespaceDuration = 0.025;
var fastDurationMultiplier = 0.33;

var chapterDelay = 2;

var instantBoundaryHeight = 0;
var veryFastBoundaryHeight = 100;
var fastBoundaryHeight = 280;
var bottomBoundaryHeight = 120;

var maxRunQuicklyCount = 2;

var topSpacerHeight = 15;

// The fuck, chrome?
var windowScrollTop = 0;
var windowHeight = 99999;

function DelayProvider () {
    this.runImmediatelyQueue = [];
    this.runImmediatelyPending = false;

    this.runQuicklyQueue = [];
    this.runQuicklyPending = false;

    this.boundStepRunImmediately = this.stepRunImmediately.bind(this);
    this.boundStepRunQuickly = this.stepRunQuickly.bind(this);
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
        setTimeout(this.boundStepRunQuickly, 0);
    }
};

DelayProvider.prototype.runAfterDelay = function (callback, delayMs) {
    if (delayMs <= 2)
        this.runQuickly(callback);
    else
        setTimeout(callback, delayMs);
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


function AnimationQueueEntry (node, animationClassName, finalClassName, customDuration) {
    this.node = node;
    this.top = null;
    this.bottom = null;
    this.animationClassName = animationClassName;
    this.finalClassName = finalClassName;
    this.customDuration = customDuration;
};

AnimationQueueEntry.prototype.computeDimensions = function () {
    if (this.top === null)
        this.top = this.node.offsetTop;

    if (this.bottom === null)
        this.bottom = this.top + this.node.offsetHeight;
};

AnimationQueueEntry.prototype.activate = function (delayProvider, onComplete) {
    this.computeDimensions();

    var completed = false;
    var self = this;

    function fireOnComplete () {
        if (completed)
            return;

        completed = true;

        if (self.animationClassName === null) {
            if (self.finalClassName !== null)
                self.node.className = self.finalClassName;
        }

        onComplete(self);
    }

    function timeoutHandler () {
        fireOnComplete();
    }

    function animationEndHandler () {
        self.node.removeEventListener("animationend", animationEndHandler, false);
        self.node.removeEventListener("webkitAnimationEnd", animationEndHandler, false);

        if (self.finalClassName !== null)
            self.node.className = self.finalClassName;

        fireOnComplete();
    };

    // !@&%(*!@)

    var instantBoundary = windowScrollTop + instantBoundaryHeight;
    var veryFastBoundary = windowScrollTop + veryFastBoundaryHeight;
    var fastBoundary = windowScrollTop + fastBoundaryHeight;
    var suspendBoundary = (windowScrollTop + windowHeight) - bottomBoundaryHeight;

    var completeInstantly = self.top <= instantBoundary;
    var completeVeryFast = self.top <= veryFastBoundary;
    var completeFast = self.top <= fastBoundary;
    // FIXME: use self.bottom? Seems too aggressive.
    var suspend = self.top >= suspendBoundary;

    if (suspend) {
        return false;
    } else if (completeInstantly || completeVeryFast) {
        // HACK: Don't trigger animation, just set final class now.
        self.animationClassName = null;

        if (completeInstantly)
            delayProvider.runImmediately(fireOnComplete);
        else
            delayProvider.runQuickly(fireOnComplete);

        return true;
    }

    var result = false;

    if (self.animationClassName !== null) {
        self.node.addEventListener("animationend", animationEndHandler, false);
        // fuck chrome
        self.node.addEventListener("webkitAnimationEnd", animationEndHandler, false);

        self.node.className = 
            completeFast
                ? self.animationClassName + " animateFast"
                : self.animationClassName;

        result = true;
    }

    if (typeof (self.customDuration) === "number") {
        var delayMs = self.customDuration * 1000;
        if (completeFast)
            delayMs *= fastDurationMultiplier;

        delayProvider.runAfterDelay(timeoutHandler, delayMs);
        result = true;
    }

    if (!result)
        throw new Error("Invalid animation queue entry");

    return result;
};


function AnimationQueue () {
    this.queue = [];
    this.position = 0;
    this.onComplete = null;
    this.delayProvider = new DelayProvider();

    this.boundStep = this.step.bind(this);
    this.boundStepComplete = this.stepComplete.bind(this);
};

AnimationQueue.prototype.enqueue = function (node, animationClassName, finalClassName, customDuration) {
    var result = new AnimationQueueEntry(node, animationClassName, finalClassName, customDuration);
    this.queue.push(result);
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

    entry = this.queue[this.position];

    var pauseIndicator = document.querySelector("pauseindicator");

    if (!entry.activate(this.delayProvider, this.boundStepComplete)) {
        if (pauseIndicator.className !== "paused")
            pauseIndicator.className = "paused";

        window.setTimeout(this.boundStep, 50);
    } else {
        if (pauseIndicator.className !== "unpaused")
            pauseIndicator.className = "unpaused";
    }
};

AnimationQueue.prototype.start = function () {
    // Do layout in advance for the whole queue.
    for (var i = 0, l = this.queue.length; i < l; i++) {
        this.queue[i].computeDimensions();
    }

    this.step();
};


function onLoad () {
    var chapters = document.querySelectorAll("chapter");
    var animationQueue = new AnimationQueue();

    for (var i = 0, l = chapters.length; i < l; i++) {
        var chapter = chapters[i];
        var sections = chapter.querySelectorAll("section");

        for (var i2 = 0, l2 = sections.length; i2 < l2; i2++) {
            var section = sections[i2];
            var paragraphs = section.querySelectorAll("p");

            for (var i3 = 0, l3 = paragraphs.length; i3 < l3; i3++) {
                var p = paragraphs[i3];

                spanifyCharacters(p, animationQueue);

                trimWhitespace(p);
            }
        }

        // HACK: Insert delay at end of chapter
        var lastEntry = animationQueue.queue[animationQueue.queue.length - 1];
        if (lastEntry) {
            lastEntry.customDuration += chapterDelay;
        }
    }

    // Chrome is utterly miserable at reading the .scrollY property, so...
    window.addEventListener("scroll", onScroll, false);
    onScroll();

    window.addEventListener("resize", resizeSpacer, false);
    resizeSpacer();

    document.querySelector("story").className = "";
    animationQueue.start();
};

function onScroll () {
    windowScrollTop = document.querySelector("body").scrollTop;
    windowHeight = window.innerHeight;
};

function resizeSpacer () {
    var spacerHeight = (window.innerHeight * topSpacerHeight / 100);
    document.querySelector("topspacer").style.height = spacerHeight.toFixed(1) + "px";
    windowHeight = window.innerHeight;
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
    if (e.firstChild.className === "whitespace") {
        e.removeChild(e.firstChild);
    }

    if (e.lastChild.className === "whitespace") {
        e.removeChild(e.lastChild);
    }
};

function spanifyCharacters (e, animationQueue) {
    var textNodes = enumerateTextNodes(e);
    var lastPause = null;

    var isFirstTextNode = true;

    for (var i = 0, l = textNodes.length; i < l; i++) {
        var textNode = textNodes[i];

        var f = document.createDocumentFragment();
        var currentWord = null;
        var currentWhitespace = null;

        var text = textNode.nodeValue;

        for (var l2 = text.length, i2 = 0; i2 < l2; i2++) {
            var ch = text[i2];

            if (ch.trim().length === 0) {
                if (currentWord) {
                    f.appendChild(currentWord);
                    currentWord = null;
                }

                if (currentWhitespace === null) {
                    currentWhitespace = document.createElement("span");
                    currentWhitespace.className = "whitespace";
                    currentWhitespace.textContent = ch;

                    f.appendChild(currentWhitespace);
                    lastPause = animationQueue.enqueue(currentWhitespace, null, null, whitespaceDuration);

                } else {

                    currentWhitespace.textContent += ch;
                    lastPause.customDuration += successiveWhitespaceDuration;
                }

            } else {

                currentWhitespace = null;
                lastPause = null;

                var span = document.createElement("span");
                span.textContent = ch;

                if (currentWord === null) {
                    currentWord = document.createElement("span");
                    currentWord.className = "word";
                }

                span.className = "invisible";
                animationQueue.enqueue(span, "dropInFade", "", characterDuration);

                currentWord.appendChild(span);
            }
        }

        if (currentWord)
            f.appendChild(currentWord);

        textNode.parentNode.replaceChild(f, textNode);

        isFirstTextNode = false;
    }
};