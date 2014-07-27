function AnimationQueueEntry (node, animationClassName, finalClassName, customDuration) {
    this.node = node;
    this.animationClassName = animationClassName;
    this.finalClassName = finalClassName;
    this.customDuration = customDuration;
};

AnimationQueueEntry.prototype.activate = function (onComplete) {
    var completed = false;
    var self = this;

    function fireOnComplete () {
        if (completed)
            return;

        completed = true;

        if (self.animationClassName === null) {
            if (self.finalClassName !== null)
                self.node.className = finalClassName;
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

    if (self.animationClassName !== null) {
        self.node.addEventListener("animationEnd", animationEndHandler, false);
        // fuck chrome
        self.node.addEventListener("webkitAnimationEnd", animationEndHandler, false);
        self.node.className = self.animationClassName;
    }

    if (typeof (self.customDuration) === "number") {
        window.setTimeout(timeoutHandler, self.customDuration * 1000);
    }
};


function AnimationQueue () {
    this.queue = [];
    this.onComplete = null;

    this.boundStep = this.step.bind(this);
};

AnimationQueue.prototype.enqueue = function (node, animationClassName, finalClassName, customDuration) {
    this.queue.push(new AnimationQueueEntry(node, animationClassName, finalClassName, customDuration));
};

AnimationQueue.prototype.step = function () {
    if (this.queue.length === 0) {
        if (this.onComplete)
            this.onComplete(this);

        return;
    }

    var entry = this.queue.shift();
    entry.activate(this.boundStep);
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

    animationQueue.start();
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
                animationQueue.enqueue(span, null, null, 0.10);
            } else {
                span.className = "character invisible";
                animationQueue.enqueue(span, "character dropInFade", "character", 0.06);
            }

            f.appendChild(span);
        }

        textNode.parentNode.replaceChild(f, textNode);
    }
};