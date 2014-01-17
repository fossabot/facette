
/* Graph */

var GRAPH_DRAW_PARENTS  = [],
    GRAPH_DRAW_QUEUE    = [],
    GRAPH_DRAW_TIMEOUTS = {},

    GRAPH_CONTROL_LOCK    = false,
    GRAPH_CONTROL_TIMEOUT = null,

    $graphTemplate;

function graphDraw(graph, postpone, delay) {
    var graphNew;

    postpone = typeof postpone == 'boolean' ? postpone : false;
    delay    = delay || 0;

    if (graph.length > 1) {
        console.error("Can't draw multiple graph.");
        return;
    }

    if (!graph.data('setup')) {
        // Replace node with graph template
        if ($graphTemplate.length > 0) {
            graphNew = $graphTemplate.clone();

            $.each(graph.prop("attributes"), function () {
                graphNew.attr(this.name, this.value);
            });

            graph.replaceWith(graphNew);
            graph = graphNew;

            graph.data({
                options: graph.opts('graph'),
                setup: true
            });

            graph.find('.graphctrl .ranges').hide();

            graph.find('.placeholder').text(graph.data('options').title || 'N/A');
        }
    }

    // Postpone graph draw
    if (postpone) {
        graphEnqueue(graph.get(0));
        return;
    }

    return $.Deferred(function ($deferred) {
        setTimeout(function () {
            var graphOpts,
                query;

            graph.find('.placeholder').text($.t('main.mesg_loading'));

            // Parse graph options
            graphOpts = graph.data('options') || graph.opts('graph');

            if (typeof graphOpts.preview != 'boolean')
                graphOpts.preview = graphOpts.preview &&
                    graphOpts.preview.trim().toLowerCase() == 'true' ? true : false;

            if (typeof graphOpts.zoom != 'boolean')
                graphOpts.zoom = graphOpts.zoom && graphOpts.zoom.trim().toLowerCase() == 'false' ? false : true;

            if (graphOpts.sample)
                graphOpts.sample = parseInt(graphOpts.sample, 10);
            else
                delete graphOpts.sample;

            if (!graphOpts.range)
                graphOpts.range = GRAPH_DEFAULT_RANGE;

            // Set graph options
            graph.data('options', graphOpts);

            // Render graph plots
            query = {
                time: graphOpts.time,
                range: graphOpts.range,
                sample: graphOpts.sample,
                percentiles: graphOpts.percentiles ? $.map(graphOpts.percentiles.split(','), function (x) {
                    return parseFloat(x.trim());
                }) : undefined
            };

            if (graphOpts.origin && (graphOpts.template || graphOpts.metric)) {
                query.origin = graphOpts.origin;
                query.source = graphOpts.source;
                query.filter = graphOpts.filter;

                if (graphOpts.template)
                    query.template = graphOpts.template;
                else
                    query.metric = graphOpts.metric;
            } else {
                query.graph = graph.attr('data-graph');
            }

            return $.ajax({
                url: urlPrefix + '/library/graphs/plots',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify(query),
                dataType: 'json'
            }).pipe(function (data) {
                var $container,
                    highchartOpts,
                    startTime,
                    endTime,
                    info = {},
                    i,
                    j;

                if (data.message) {
                    graph.children('.graphctrl')
                        .attr('disabled', 'disabled')
                        .find('a:not([href="#refresh"])').hide();

                    graph.find('.placeholder').text(data.message);

                    return;
                } else {
                    graph.children('.graphctrl')
                        .removeAttr('disabled')
                        .find('a:not([href="#refresh"])').show();

                    graph.find('.placeholder')
                        .removeClass('icon icon-warning')
                        .hide();
                }

                startTime = moment(data.start);
                endTime   = moment(data.end);

                highchartOpts = {
                    chart: {
                        borderRadius: 0,
                        events: {
                            load: function () {
                                if (!graphOpts.preview)
                                    Highcharts.drawTable.apply(this, [info]);
                            },

                            togglePlotLine: function () {
                                var $parent,
                                    re = new RegExp('(^| +)active( +|$)');

                                $(this.chart.container).find('.highcharts-table-value.active').css({
                                    color: 'inherit',
                                    fill: 'inherit'
                                });

                                $parent = $(this.element).parent();

                                // Remove existing plot line
                                this.chart.yAxis[0].removePlotLine('plotline0');

                                if ($parent.attr('class').match(re)) {
                                    $parent.attr('class', $parent.attr('class').replace(re, ''));
                                    return;
                                }

                                // Set element active
                                $parent
                                    .css({
                                        color: '#e30',
                                        fill: '#e30'
                                    })
                                    .attr('class', $parent.attr('class') + ' active');

                                // Draw new plot line
                                this.chart.yAxis[0].addPlotLine({
                                    id: 'plotline0',
                                    color: '#e30',
                                    value: this.value,
                                    width: 1.5,
                                    zIndex: 100
                                });
                            }
                        },
                        spacingBottom: 16,
                        spacingLeft: 48,
                        spacingRight: 16,
                        spacingTop: 16,
                    },
                    credits: {
                        enabled: false
                    },
                    exporting: {
                        enabled: false
                    },
                    legend: {
                        enabled: false
                    },
                    plotOptions: {
                    },
                    series: [],
                    title: {
                        text: null
                    },
                    tooltip: {
                        formatter: function () {
                            return moment(this.x).format('LLL') + '<br>' + this.series.name + ': <strong>' +
                                humanReadable(this.y) + '</strong>';
                        },
                        useHTML: true
                    },
                    xAxis: {
                        max: endTime.valueOf(),
                        min: startTime.valueOf(),
                        type: 'datetime'
                    },
                    yAxis: {
                        plotLines: [],
                        title: {
                            text: null
                        }
                    }
                };

                // Set type-specific options
                switch (data.type) {
                case GRAPH_TYPE_AREA:
                    highchartOpts.chart.type = 'area';
                    break;
                case GRAPH_TYPE_LINE:
                    highchartOpts.chart.type = 'line';
                    break;
                default:
                    console.error("Unknown `" + data.type + "' chart type");
                    break;
                }

                highchartOpts.plotOptions[highchartOpts.chart.type] = {
                    animation: false,
                    lineWidth: 1.5,
                    marker: {
                        enabled: false
                    },
                    pointInterval: data.step * 1000,
                    pointStart: startTime.valueOf(),
                    states: {
                        hover: {
                            lineWidth: 2.5
                        }
                    }
                };

                // Enable full features when not in preview
                if (graphOpts.preview) {
                    highchartOpts.plotOptions[highchartOpts.chart.type].enableMouseTracking = false;

                    graph.children('.graphctrl').remove();
                } else {
                    if (graphOpts.title) {
                        highchartOpts.title = {
                            text: graphOpts.title
                        };
                    }

                    highchartOpts.subtitle = {
                        text: startTime.format('LLL') + ' — ' + endTime.format('LLL')
                    };

                    if (graphOpts.zoom) {
                        highchartOpts.chart.events.selection = function (e) {
                            if (e.xAxis) {
                                graphUpdateOptions(graph, {
                                    time: moment(e.xAxis[0].min).format(TIME_RFC3339),
                                    range: timeToRange(moment.duration(moment(e.xAxis[0].max)
                                        .diff(moment(e.xAxis[0].min))))
                                });

                                graphDraw(graph);
                            }

                            e.preventDefault();
                        };

                        highchartOpts.chart.zoomType = 'x';
                    }
                }

                // Set stacking options
                switch (data.stack_mode) {
                case STACK_MODE_NORMAL:
                    highchartOpts.plotOptions[highchartOpts.chart.type].stacking = 'normal';
                    break;
                case STACK_MODE_PERCENT:
                    highchartOpts.plotOptions[highchartOpts.chart.type].stacking = 'percent';
                    break;
                default:
                    highchartOpts.plotOptions[highchartOpts.chart.type].stacking = null;
                    break;
                }

                for (i in data.stacks) {
                    for (j in data.stacks[i].series) {
                        highchartOpts.series.push({
                            id: data.stacks[i].series[j].name,
                            name: data.stacks[i].series[j].name,
                            stack: data.stacks[i].name,
                            data: data.stacks[i].series[j].plots,
                            color: data.stacks[i].series[j].options ? data.stacks[i].series[j].options.color : null
                        });

                        info[data.stacks[i].series[j].name] = data.stacks[i].series[j].info;
                    }
                }

                // Prepare legend spacing
                if (!graphOpts.preview)
                    highchartOpts.chart.spacingBottom = highchartOpts.series.length * GRAPH_LEGEND_ROW_HEIGHT +
                        highchartOpts.chart.spacingBottom * 2;

                $container = graph.children('.graphcntr');

                if (!graphOpts.preview && !$container.highcharts())
                    $container.height($container.height() + highchartOpts.chart.spacingBottom);

                $container.highcharts(highchartOpts);
                $deferred.resolve();
            }).fail(function () {
                graph.children('.graphctrl')
                    .attr('disabled', 'disabled')
                    .find('a:not([href="#refresh"])').hide();

                graph.find('.placeholder')
                    .addClass('icon icon-warning')
                    .text($.t('graph.mesg_load_failed'));

                $deferred.resolve();
            });
        }, delay);
    }).promise();
}

function graphEnqueue(graph) {
    var $parent = $(graph).offsetParent(),
        parent = $parent.get(0),
        index = GRAPH_DRAW_PARENTS.indexOf(parent);

    if (index == -1) {
        GRAPH_DRAW_PARENTS.push(parent);
        GRAPH_DRAW_QUEUE.push([]);
        index = GRAPH_DRAW_PARENTS.length - 1;

        $parent.on('scroll', graphHandleQueue);
    }

    if (GRAPH_DRAW_QUEUE[index].indexOf(graph) == -1)
        GRAPH_DRAW_QUEUE[index].push(graph);
}

function graphExport(graph) {
    var canvas = document.createElement('canvas'),
        svg = graph.find('.graphcntr').highcharts().getSVG();

    canvas.setAttribute('width', parseInt(svg.match(/width="([0-9]+)"/)[1], 10));
    canvas.setAttribute('height', parseInt(svg.match(/height="([0-9]+)"/)[1], 10));

    if (canvas.getContext && canvas.getContext('2d')) {
        canvg(canvas, svg);

        window.location.href = canvas.toDataURL('image/png')
            .replace('image/png', 'image/octet-stream');

    } else {
        console.error("Your browser doesn't support mandatory Canvas feature");
    }
}

function graphHandleActions(e) {
    var $target = $(e.target),
        $graph = $target.closest('[data-graph]'),
        $overlay,
        graphObj,
        delta,
        options,
        range;

    if (e.target.href.endsWith('#reframe-all')) {
        // Apply current options to siblings
        $graph.siblings('[data-graph]').each(function () {
            var $item = $(this),
                options = $graph.data('options');

            graphUpdateOptions($item, {
                time: options.time || null,
                range: options.range || null
            });

            graphDraw($item, !$item.inViewport());
        });

        graphDraw($graph);
    } else if (e.target.href.endsWith('#refresh')) {
        // Refresh graph
        graphDraw($graph, false);
    } else if (e.target.href.endsWith('#reset')) {
        // Reset graph to its initial state
        $graph.data('options', null);
        graphDraw($graph);
    } else if (e.target.href.endsWith('#save')) {
        graphExport($graph);
    } else if (e.target.href.endsWith('#set-range')) {
        // Toggle range selector
        $(e.target).closest('.graphctrl').find('.ranges').toggle();
    } else if (e.target.href.endsWith('#set-time')) {
        options = $graph.data('options');

        $overlay = overlayCreate('time', {
            callbacks: {
                validate: function () {
                    graphUpdateOptions($graph, {
                        time: moment($overlay.find('input[name=time]').val()).format(TIME_RFC3339),
                        range: $overlay.find('input[name=range]').val()
                    });

                    graphDraw($graph);
                }
            }
        });

        $overlay.find('input[name=time]').appendDtpicker({
            closeOnSelected: true,
            current: options.time ? moment(options.time).format('YYYY-MM-DD HH:mm') : null,
            firstDayOfWeek: 1,
            minuteInterval: 10,
            todayButton: false
        });

        $overlay.find('input[name=range]').val(options.range || '');
    } else if (e.target.href.substr(e.target.href.lastIndexOf('#')).startsWith('#range-')) {
        range = e.target.href.substr(e.target.href.lastIndexOf('-') + 1);

        // Set graph range
        graphUpdateOptions($graph, {
            time: null,
            range: '-' + range
        });

        graphDraw($graph);
    } else if (e.target.href.endsWith('#step-backward') || e.target.href.endsWith('#step-forward')) {
        graphObj = $graph.children('.graphcntr').highcharts();

        delta = (graphObj.xAxis[0].max - graphObj.xAxis[0].min) / 4;

        if (e.target.href.endsWith('#step-backward'))
            delta *= -1;

        graphUpdateOptions($graph, {
            time: moment(graphObj.xAxis[0].min).add(delta).format(TIME_RFC3339),
            range: $graph.data('options').range.replace(/^-/, '')
        });

        graphDraw($graph);
    } else if (e.target.href.endsWith('#zoom-in') || e.target.href.endsWith('#zoom-out')) {
        graphObj = $graph.children('.graphcntr').highcharts();

        delta = graphObj.xAxis[0].max - graphObj.xAxis[0].min;

        if (e.target.href.endsWith('#zoom-in')) {
            range = timeToRange(delta / 2);
            delta /= 4;
        } else {
            range = timeToRange(delta * 2);
            delta = (delta / 2) * -1;
        }

        graphUpdateOptions($graph, {
            time: moment(graphObj.xAxis[0].min).add(delta).format(TIME_RFC3339),
            range: range
        });

        graphDraw($graph);
    } else {
        return;
    }

    e.preventDefault();
}

function graphHandleMouse(e) {
    var $target = $(e.target),
        $graph = $target.closest('[data-graph]'),
        $control = $graph.children('.graphctrl'),
        margin,
        offset;

    // Handle control lock
    if (e.type == 'mouseup' || e.type == 'mousedown') {
        GRAPH_CONTROL_LOCK = e.type == 'mousedown';
        return;
    }

    // Stop if graph has no control or is disabled
    if (GRAPH_CONTROL_LOCK || $control.length === 0 || $control.attr('disabled'))
        return;

    if (e.type != 'mousemove') {
        // Check if leaving graph
        if ($target.closest('.step, .actions').length === 0) {
            $graph.find('.graphctrl .ranges').hide();
            return;
        }

        if (GRAPH_CONTROL_TIMEOUT)
            clearTimeout(GRAPH_CONTROL_TIMEOUT);

        // Apply mask to prevent SVG events
        if (e.type == 'mouseenter')
            $control.addClass('active');
        else
            GRAPH_CONTROL_TIMEOUT = setTimeout(function () { $control.removeClass('active'); }, 1000);

        return;
    }

    // Handle steps display
    margin = ($graph.outerWidth(true) - $graph.innerWidth()) * 3;
    offset = $graph.offset();

    if ($target.closest('.actions').length === 0) {
        if (e.pageX - offset.left <= margin) {
            $control.find('.step a[href$=#step-backward]').addClass('active');
            return;
        } else if (e.pageX - offset.left >= $graph.width() - margin) {
            $control.find('.step a[href$=#step-forward]').addClass('active');
            return;
        }
    }

    $control.find('.step a').removeClass('active');
}

function graphHandleQueue(force) {
    var $deferreds = [];

    force = typeof force == 'boolean' ? force : false;

    if (GRAPH_DRAW_TIMEOUTS.draw)
        clearTimeout(GRAPH_DRAW_TIMEOUTS.draw);

    if (GRAPH_DRAW_TIMEOUTS.mesg)
        clearTimeout(GRAPH_DRAW_TIMEOUTS.mesg);

    return $.Deferred(function ($deferred) {
        GRAPH_DRAW_TIMEOUTS.draw = setTimeout(function () {
            var $graph,
                count = 0,
                delay = 0,
                i,
                j;

            GRAPH_DRAW_TIMEOUTS.mesg = setTimeout(function () {
                overlayCreate('loader', {
                    message: $.t('graph.mesg_loading')
                });
            }, 1000);

            for (i in GRAPH_DRAW_QUEUE) {
                for (j in GRAPH_DRAW_QUEUE[i]) {
                    if (!GRAPH_DRAW_QUEUE[i][j]) {
                        count += 1;
                        continue;
                    }

                    $graph = $(GRAPH_DRAW_QUEUE[i][j]);

                    if (force || $graph.inViewport()) {
                        $deferreds.push(graphDraw($graph, false, delay));
                        GRAPH_DRAW_QUEUE[i][j] = null;

                        if (force)
                            delay += GRAPH_DRAW_DELAY;
                    }
                }

                if (count == GRAPH_DRAW_QUEUE[i].length)
                    $(GRAPH_DRAW_PARENTS[i]).off('scroll', graphHandleQueue);
            }

            $.when.apply(null, $deferreds).then(function () {
                if (GRAPH_DRAW_TIMEOUTS.mesg)
                    clearTimeout(GRAPH_DRAW_TIMEOUTS.mesg);

                overlayDestroy('loader');
                $deferred.resolve();
            });
        }, 200);
    }).promise();
}

function graphSetupTerminate() {
    var $graphs = $('[data-graph]');

    // Get graph template
    $graphTemplate = $('.graphtmpl').removeClass('graphtmpl').detach();

    // Draw graphs
    $graphs.each(function () {
        var $item,
            id = this.getAttribute('data-graph');

        if (!id)
            return;

        $item = $(this);
        graphDraw($item, !$item.inViewport());
    });

    if ($graphs.length > 0) {
        Highcharts.setOptions({
            global : {
                useUTC : false
            }
        });
    }

    // Attach events
    $window
        .on('resize', graphHandleQueue);

    $body
        .on('mouseup mousedown mousemove mouseleave', '[data-graph]', graphHandleMouse)
        .on('mouseenter mouseleave', '.graphctrl .step, .graphctrl .actions', graphHandleMouse)
        .on('click', '[data-graph] a', graphHandleActions)
        .on('click', '.graphlist a', graphHandleQueue);
}

function graphUpdateOptions(graph, options) {
    graph.data('options', $.extend(graph.data('options'), options));
}

// Register setup callbacks
setupRegister(SETUP_CALLBACK_TERM, graphSetupTerminate);
