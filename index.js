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
    "descend-fade-in": 0.180,
    "drop-in-fade": 0.180,
    "blurry-fade-in": 0.400
};

var chapterDelay = 2;

var maxRunQuicklyCount = 3;

var instantBoundaryHeight = 0;
var veryFastBoundaryHeight = 40;
var fastBoundaryPercentage = 25;
var bottomBoundaryHeight = 140;
var topSpacerPercentage = 15;
var pauseIndicatorScrollMargin = 220;

// The fuck, chrome?
var windowScrollTop = 0;
var windowHeight = 99999;

var pausedAtY = null;

var animationQueue = null;

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


function AnimationQueueEntry (nodes, animationName, finalClassName, characterPause) {
    if (!Array.isArray(nodes))
        throw new Error("First argument must be an array of nodes");

    this.nodes = nodes;
    this.top = null;
    this.bottom = null;
    this.animationName = animationName;
    this.finalClassName = finalClassName;
    this.characterPause = characterPause;
    this.extraDelay = 0;
    this.isActive = false;
};

AnimationQueueEntry.prototype.measure = function () {
    var top = 999999;
    var bottom = 0;

    for (var i = 0, l = this.nodes.length; i < l; i++) {
        var node = this.nodes[i];
        top = Math.min(top, node.offsetTop);
        bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
    }

    this.top = top;
    this.bottom = bottom;
};

AnimationQueueEntry.prototype.activate = function (delayProvider, onComplete) {
    if (this.isActive)
        throw new Error("Already active");

    var completed = false;
    var self = this;

    var lastNode = self.nodes[self.nodes.length - 1];

    function applyFinalClass () {
        for (var i2 = 0, l2 = self.nodes.length; i2 < l2; i2++) {
            var node = self.nodes[i2];

            if (self.finalClassName !== null)
                node.className = self.finalClassName;
            else
                node.removeAttribute("class");

            node.style.webkitAnimationFillMode = node.style.animationFillMode = "";
            node.style.webkitAnimationDelay = node.style.animationDelay = "";
            node.style.webkitAnimationDuration = node.style.animationDuration = "";
            node.style.webkitAnimationName = node.style.animationName = "";
        }

    }

    function fireOnComplete () {
        if (completed)
            return;

        completed = true;

        if (self.animationName === null) {
            applyFinalClass();
        }

        onComplete(self);
    }

    function timeoutHandler () {
        fireOnComplete();
    }

    function animationEndHandler () {
        lastNode.removeEventListener("animationend", animationEndHandler, false);
        lastNode.removeEventListener("webkitAnimationEnd", animationEndHandler, false);

        applyFinalClass();

        if ((self.characterPause === null) && (self.extraDelay === null)) {
            fireOnComplete();
        }
    };

    // !@&%(*!@)

    var instantBoundary = windowScrollTop + instantBoundaryHeight;
    var veryFastBoundary = windowScrollTop + veryFastBoundaryHeight;
    var fastBoundary = windowScrollTop + (windowHeight * fastBoundaryPercentage / 100);
    var suspendBoundary = (windowScrollTop + windowHeight) - bottomBoundaryHeight;

    var completeInstantly = self.top <= instantBoundary;
    var completeVeryFast = self.top <= veryFastBoundary;
    var completeFast = self.top <= fastBoundary;
    // FIXME: use self.bottom? Seems too aggressive.
    var suspend = self.top >= suspendBoundary;

    var characterPause = self.characterPause;
    if (completeFast)
        characterPause *= fastDurationMultiplier;

    pausedAtY = null;
    if (suspend) {
        pausedAtY = self.bottom;

        return false;
    } else if (completeInstantly || completeVeryFast) {
        // HACK: Don't trigger animation, just set final class now.
        self.animationName = null;

        if (completeInstantly)
            delayProvider.runImmediately(fireOnComplete);
        else
            delayProvider.runQuickly(fireOnComplete);

        return true;
    }

    var result = false;

    if (self.animationName !== null) {
        lastNode.addEventListener("animationend", animationEndHandler, false);
        // fuck chrome
        lastNode.addEventListener("webkitAnimationEnd", animationEndHandler, false);

        var localDelay = 0;
        for (var i = 0, l = self.nodes.length; i < l; i++) {
            var node = self.nodes[i];
            var localDuration = animationDurations[self.animationName];
            if (completeFast)
                localDuration *= fastDurationMultiplier;

            node.className = "";
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

        delayProvider.runAfterDelay(timeoutHandler, delayMs);
        result = true;
    }

    if (!result)
        throw new Error("Invalid animation queue entry");

    this.isActive = true;
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

AnimationQueue.prototype.enqueue = function (node, animationName, finalClassName, characterPause) {
    var result = new AnimationQueueEntry(node, animationName, finalClassName, characterPause);
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

    if (!entry.activate(this.delayProvider, this.boundStepComplete)) {
        window.setTimeout(this.boundStep, 250);
    }

    updatePauseIndicator();
};

AnimationQueue.prototype.measure = function () {
    for (var i = 0, l = this.queue.length; i < l; i++) {
        this.queue[i].measure();
    }
};

AnimationQueue.prototype.start = function () {
    this.step();
};


function onLoad () {
    animationQueue = new AnimationQueue();

    // Chrome is utterly miserable at reading the .scrollY property, so...
    window.addEventListener("scroll", onScroll, false);
    onScroll();

    window.addEventListener("resize", resizeSpacer, false);
    resizeSpacer();

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
                completed = true;
                onComplete();
            }
        },
        inactive: function () {
            console.log("Could not load fonts");
            
            if (!completed) {
                completed = true;
                onComplete();
            }
        }
    });
};

function prepareStory (onComplete) {
    console.log("Preparing story layout");
    var chapters = document.querySelectorAll("chapter");

    var i = 0, l = chapters.length;

    function step () {
        if (i >= l) {
            finished();
            return;
        }

        console.log("Laying out chapter " + i);

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
            lastEntry.extraDelay += chapterDelay;
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

function onScroll () {
    windowScrollTop = window.pageYOffset;
    windowHeight = window.innerHeight;

    updatePauseIndicator();
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

function resizeSpacer () {
    windowHeight = window.innerHeight;

    var spacerHeight = (windowHeight * topSpacerPercentage / 100);
    document.querySelector("topspacer").style.height = spacerHeight.toFixed(1) + "px";
    document.querySelector("bottomspacer").style.height = spacerHeight.toFixed(1) + "px";

    animationQueue.measure();
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
                    lastPause = animationQueue.enqueue(
                        [currentWhitespace], null, null, whitespaceDuration
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

                    wordAnimation = animationQueue.enqueue(
                        currentWordNodes, animationName, null, characterDuration
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

        textNode.parentNode.replaceChild(f, textNode);

        isFirstTextNode = false;
    }
};