var characterDuration = 0.035;
var whitespaceDuration = 0.08;
var successiveWhitespaceDuration = 0.03;
var fastDurationMultiplier = 0.4;

var instantBoundaryHeight = 200;
var fastBoundaryHeight = 400;
var bottomBoundaryHeight = 160;

var maxRunImmediatelyCount = 6;

function DelayProvider () {
    this.runImmediatelyQueue = [];
    this.runImmediatelyPending = false;

    this.boundStep = this.step.bind(this);
};

DelayProvider.prototype.runImmediately = function (callback) {
    this.runImmediatelyQueue.push(callback);

    if (!this.runImmediatelyPending) {
        this.runImmediatelyPending = true;
        setTimeout(this.boundStep, 0);
    }
};

DelayProvider.prototype.runAfterDelay = function (callback, delayMs) {
    if (delayMs <= 1)
        this.runImmediately(callback);
    else
        setTimeout(callback, delayMs);
};

DelayProvider.prototype.step = function () {
    this.runImmediatelyPending = false;

    var toRun = Math.min(items.length, maxRunImmediatelyCount);
    for (var i = 0; i < toRun; i++) {
        items[i]();
    }

    items.splice(0, toRun);

    if (items.length > 0) {
        this.runImmediatelyPending = true;
        setTimeout(this.boundStep, 0);
    }
};


function AnimationQueueEntry (node, animationClassName, finalClassName, customDuration) {
    this.node = node;
    this.animationClassName = animationClassName;
    this.finalClassName = finalClassName;
    this.customDuration = customDuration;
};

AnimationQueueEntry.prototype.activate = function (delayProvider, onComplete) {
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
        self.node.removeEventListener("animationEnd", animationEndHandler, false);
        self.node.removeEventListener("webkitAnimationEnd", animationEndHandler, false);

        if (self.finalClassName !== null)
            self.node.className = self.finalClassName;

        fireOnComplete();
    };

    var instantBoundary = window.scrollY + instantBoundaryHeight;
    var fastBoundary = window.scrollY + fastBoundaryHeight;
    var suspendBoundary = (window.scrollY + window.innerHeight) - bottomBoundaryHeight;

    var completeInstantly = self.node.offsetTop <= instantBoundary;
    var completeFast = self.node.offsetTop <= fastBoundary;
    var suspend = (self.node.offsetTop + self.node.offsetHeight) >= suspendBoundary;

    if (suspend) {
        return false;
    } else if (completeInstantly) {
        // HACK: Don't trigger animation, just set final class now.
        self.animationClassName = null;

        fireOnComplete();
        return true;
    }

    var result = false;

    if (self.animationClassName !== null) {
        self.node.addEventListener("animationEnd", animationEndHandler, false);
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

    if (!entry.activate(this.delayProvider, this.boundStepComplete)) {
        window.setTimeout(this.boundStep, 50);
    }
};

AnimationQueue.prototype.start = function () {
    this.step();
};


function onLoad () {
    var paragraphs = document.querySelectorAll("p");
    var animationQueue = new AnimationQueue();

    for (var i = 0, l = paragraphs.length; i < l; i++) {
        var p = paragraphs[i];

        spanifyCharacters(p, animationQueue);
    }

    window.addEventListener("resize", resizeSpacer, false);
    resizeSpacer();

    document.querySelector("story").className = "";
    animationQueue.start();
};

function resizeSpacer () {
    var spacerHeight = (window.innerHeight * 40 / 100);
    document.querySelector("topspacer").style.height = spacerHeight.toFixed(1) + "px";
};

function enumerateTextNodes (e, output) {
    if (!output)
        output = [];

    for (var c = e.childNodes, i = 0, l = c.length; i < l; i++) {
        var child = c[i];

        if (child.nodeType === Node.TEXT_NODE) {
            output.push(child);
        } else {
            enumerateTextNodes(child, output);
        }
    }

    return output;
};

function spanifyCharacters (e, animationQueue) {
    var textNodes = enumerateTextNodes(e);
    var lastPause = null;

    for (var i = 0, l = textNodes.length; i < l; i++) {
        var textNode = textNodes[i];
        if (textNode.nodeValue.length === 0)
            continue;

        var f = document.createDocumentFragment();
        for (var v = textNode.nodeValue, l2 = v.length, i2 = 0; i2 < l2; i2++) {
            var ch = v[i2];
            var span = document.createElement("span");
            span.textContent = ch;

            if (ch.trim().length === 0) {
                span.className = "character";

                if (lastPause !== null) {
                    lastPause.customDuration += successiveWhitespaceDuration;
                } else {
                    lastPause = animationQueue.enqueue(span, null, null, whitespaceDuration);
                }
            } else {
                span.className = "character invisible";
                animationQueue.enqueue(span, "character dropInFade", "character", characterDuration);
                lastPause = null;
            }

            f.appendChild(span);
        }

        textNode.parentNode.replaceChild(f, textNode);
    }
};