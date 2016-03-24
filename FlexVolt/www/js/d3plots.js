/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

/* Original Author:  Brendan Flynn
 * 
 * factory for drawing the xyDot and trace plots
 * 
 */
(function () {
'use strict';

angular.module('flexvolt.d3plots', [])

/**
 * Abstracts the flexvolt, deals with bluetooth communications, etc.
 */
.factory('myometerPlot', function() {
    var mar, margin, width, height, plotElement;
    mar = 10;
    margin = {top: mar, right: mar, bottom: mar, left: 70};
    var headerPadding = 0;
    var footerPadding = 200;
    width = window.innerWidth - margin.left - margin.right,
    height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
    
    //console.log('height: '+height);
    
    var GAIN = 1845; // 
    var yMax = 1000*2.5/GAIN; //mV // 1.35
    var factor = 1000*2.5/(GAIN*128); // 0.0105
    
    var svg, xScale, xAxis, yScale, yAxis, data = [], bar, yLabel;
    var textLabel = undefined;
    var updateTargets;
    var yTicks = [0, 5, 10, 15, 20, 25, 30, 35];
    
    var api = {
      init:undefined,
      reset:undefined,
      resize:undefined,
      update:undefined,
      settings:undefined,
      addText: undefined,
      removeText: undefined
    };
    
    var dragging = false;
    
    var drag = d3.behavior.drag()
      .origin(Object)
      .on('dragstart', function(){dragging = true;})
      .on("drag", dragmove)
      .on('dragend', function(){
        var dragger = d3.select(this);
        var colInd = dragger[0][0]['__data__']['x'];
        var newVal = parseInt(dragger.attr("y"));
        var scaledVal;
        if (api.settings.baselineMode === 'absolute'){
          scaledVal = parseInt(yMax*((height-newVal)/height)/factor);
        } else if (api.settings.baselineMode === 'relative'){
          scaledVal = parseInt(100*((height-newVal)/height));
        }
        //console.log('ob: '+colInd+'to: '+ newVal+ ', and scaled: '+scaledVal);
        updateTargets(colInd, scaledVal);
        api.settings.targets[api.settings.baselineMode][colInd-1] = scaledVal;
        api.reset();
        dragging = false;
        });

    function dragmove() {
      var dragger = d3.select(this);
      //var colInd = dragger[0][0]['__data__']['x'];
      var newVal = d3.event.dy + parseInt(dragger.attr("y"));
      //console.log('ob: '+colInd+'from: '+ parseInt(dragger.attr("y"))+ ', plus: '+(d3.event.dy)+', to '+newVal);
      newVal = Math.min(Math.max(newVal,0),height);
//      var scaledVal;
//      if (api.settings.baselineMode === 'absolute'){
//        scaledVal = parseInt((newVal/height)/factor);
//      } else if (api.settings.baselineMode === 'relative'){
//        scaledVal = parseInt(100*(newVal/height));
//      }
      //console.log('dragged: newVal:'+newVal+', scalledVal: '+scaledVal);
      dragger.attr("y", function(){return newVal;});
    }

    
    function drawTargets(){
      svg.selectAll('limits')
          .data(data)
          .enter()
          .append('rect')
          .attr("rx", 6)
          .attr("ry", 6)
          .attr('x', function(d) {return xScale(d.x)-3;})
          .attr('y', function(d) {return yScale(d.target);})
          .attr('width', xScale.rangeBand()+6)
          .attr('height', 6)
          .attr('stroke', 'rgb(0,0,0)')
          .attr('fill', 'rgb(150, 150, 150)')
          .attr("cursor", "move")
          .call(drag);;

    }
    
    api.reset = function(){
      if (svg){
        svg.selectAll('path.rect').remove();
        d3.select('svg').remove();
      }
      
      data = [];     
      var targetTmp;
      for (var k = 0; k<api.settings.nChannels; k++){
          data[k]={x:0, y:0, limit:-50, label:''};
          data[k].x = k+1;
          data[k].value = 0;
          if (api.settings.baselineMode === 'relative'){
            targetTmp = api.settings.targets[api.settings.baselineMode][k];
            targetTmp = Math.min(Math.max(targetTmp,0),100);
          } else if (api.settings.baselineMode === 'absolute'){
            targetTmp = factor*api.settings.targets[api.settings.baselineMode][k];
            targetTmp = Math.min(Math.max(targetTmp,0),yMax);
          }
          data[k].target = targetTmp;
          
          data[k].label = api.settings.labels[k];
      }
      
      xScale = d3.scale.ordinal()
        .rangeBands([0, width], 0.2)
        .domain(data.map(function(d) { return d.x; }));

      yScale = d3.scale.linear()
        .range([height, 0])

      if (api.settings.baselineMode === 'absolute'){
        yScale.domain([0, yMax])
        yLabel = 'Signal Strength, mV';
      } else if (api.settings.baselineMode === 'relative'){
        yScale.domain([0, 100]);
        yLabel = '% Maximum Contraction';
      }

      yAxis = d3.svg.axis()
              .scale(yScale)
              .orient('left')
//              .tickValues(yTicks)
              .tickSize(10,0)
              .tickSubdivide(true)
              .tickPadding(10)
              .tickSize(-width);
      
      xAxis = d3.svg.axis().scale(xScale).orient('bottom').tickFormat(function(d,i){return api.settings.labels[i];}).tickSize(10);

      svg = d3.select(plotElement).append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      // x-axis
      svg.append('g')
          .attr('class', 'axisnoline')
          .attr('font-size', 20)
          .attr('fill', 'rgb(0,0,0)')
          .attr('format', 'd')
          .attr('transform', 'translate(0,' + height + ')')
          .call(xAxis)
  
      // y-axis
      svg.append('g')
          .attr('class', 'axisnoline')
          .attr('font-size', 20)
          .attr('fill', 'rgb(0,0,0)')
          .call(yAxis)
          .append('text')
          .attr('class', 'label')
          .attr('transform', 'rotate(-90)')
          .attr('y', -60)
          .attr('x', -height/2)
          .attr('dy', '.71em')
          .attr('fill', 'rgb(0,0,0)')
          .style('text-anchor', 'middle')
          .text(yLabel);
  
      drawTargets();
    };

    api.init = function(element, settings, limitsCB){
        width = window.innerWidth - margin.left - margin.right,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
        plotElement = element;
        api.settings = settings;
        updateTargets = limitsCB;
        
        api.reset();
    };
    
    api.addText = function(text){
      d3.select('#notificationText').remove();
      //console.log('DEBUG: added text: '+text);
      textLabel = text;
    };
    
    api.removeText = function(){
      d3.select('#notificationText').remove();
      textLabel = undefined;
    };
    
    api.update = function(dataIn){
      if (dragging){
        // don't update rectangles while dragging - race conditions
        return;
      }
      
      for (var k = 0; k < api.settings.nChannels; k++){
        data[k].value = Math.max(0,dataIn[k]); // adjusting to actual
      }

      svg.selectAll('rect').remove();
      svg.selectAll('bars')
        .data(data)
        .enter()
        .append('rect')
        .attr('x', function(d) {return xScale(d.x);})
        .attr('y', function(d) {return yScale(d.value);})
        .attr('width', xScale.rangeBand())
        .attr('height', function(d) {return height-yScale(d.value);})
        .attr('stroke', 'rgb(0,0,0)')
        .attr('fill', function(d) {if(d.value > d.target){return 'orange';} else {return 'blue';}});

      drawTargets();

      if (textLabel){
        d3.select('#notificationText').remove();
        svg.append('text')
          .attr('id','notificationText')
          .attr('x', width/2)
          .attr('y', margin.top+height/2)
          .text(textLabel)
          .attr('fill','black')
          .attr('text-anchor', 'middle')
          .style('font', '16px Helvetica');
      }
    }
    
    api.resize = function(){
        console.log('DEBUG: plot resized');
        width = window.innerWidth - margin.left - margin.right,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
          
        api.reset();
    };

    return api;
})
.factory('xyDot', function() {
    var mar, margin, width, height, plotElement;
    mar = 10;
    margin = {top: mar, right: mar, bottom: mar, left: mar};
    var headerPadding = 44;
    var footerPadding = 68;
    var xValue, xScale, xMap, yValue, yScale, yMap;
    var tail = true;
    var dataset = [];
    var nDots = 6;

    var svg;

    var api = {
        init:undefined,
        update:undefined,
        resize:undefined,
        dotRadius:undefined,
        settings:{
            s1:1,
            s2:2
        }
    };
    
    api.dotRadius = 15;
    
    api.reset = function(){
        if (svg){
          d3.select('svg').remove();
        }
        svg = d3.select(plotElement).append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
    
        xValue = function(d) { return d.x;},
        xScale = d3.scale.linear()
            .range([api.dotRadius, width-api.dotRadius])
            .domain([0, 255]),
        xMap = function(d) {return xScale(xValue(d));};
        yValue = function(d) { return d.y;},
        yScale = d3.scale.linear()
            .range([height-api.dotRadius, api.dotRadius])
            .domain([0, 255]),
        yMap = function(d) {return yScale(yValue(d));};

        if (!!tail){
          for (var i=0; i<nDots;i++){
            dataset[i]={
              x:width/2,
              y:height/2,
              r:api.dotRadius,
              c:'#1f77b4',
              o:(1.0-i/nDots)
            };
          }
        } else {
          dataset[0]={
            x:width/2,
            y:height/28,
            r:api.dotRadius,
            c:'#1f77b4',
            o:1.0
          };
        }
    }

    api.init = function(element){
        plotElement = element;
        width = window.innerWidth - margin.left - margin.right,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
        
        api.reset();
    }
    
    api.update = function(xIn, yIn){
        if(!!tail){
          for (var i=nDots-1; i>0; i--){
                dataset[i].x = dataset[i-1].x;
                dataset[i].y = dataset[i-1].y;
            }
            dataset[0].x = xIn;
            dataset[0].y = yIn;
        } else {
          dataset[0].x = xIn;
          dataset[0].y = yIn;
        }
        
        svg.selectAll('circle').remove();
        svg.selectAll('circle')
            .data(dataset)
            .enter().append('circle')
            .style('stroke', function(d){return d.c;})
            .style('fill', function(d){return d.c;})
            .style('opacity', function(d){return d.o;})
            .attr('r', function(d){return d.r;})
            .attr('cx', xMap)
            .attr('cy', yMap);
    }
    
    api.resize = function(){
        width = window.innerWidth - margin.left - margin.right,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
        
        api.reset();
    };

    return api;
})
.factory('tracePlot', function() {
    var colorList = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'];
    var mar, margin, width, height, plotElement;
    mar = 10;
    var headerPadding = 44;
    var footerPadding = 68;
    margin = {top: mar, right: mar, bottom: mar, left: mar};

    var yMax = 128;
    var tmpData = [];
    var xPos = 0, startPos = 0;
        
    var svg, yA, lineA;

    var api = {
      init:undefined,
      reset:undefined,
      resize:undefined,
      update:undefined,
      setN:undefined,
      settings:{
        nChannels: 2  
      }
    };

    function setN(newN) {
      api.settings.nChannels = newN;
    }
    
    api.reset = function(){
        if (svg){
          svg.selectAll('path.line').remove();
          d3.select('svg').remove();
        }
        svg = d3.select(plotElement).append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')'); 
    
        xPos = 0;
        startPos = 0;
        yA = [];
        tmpData = [];
        for (var i = 0; i < api.settings.nChannels; i++){
            tmpData[i] = undefined;
            yA[i] = d3.scale.linear()
                .range([height-i*(height/api.settings.nChannels), height-(i+1)*(height/api.settings.nChannels)])
                .domain([-yMax, +yMax]);
        }  

        lineA = [];
        if (api.settings.nChannels > 0){
            lineA[0] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[0](d); });
        }
        if (api.settings.nChannels > 1){
            lineA[1] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[1](d); });
        }
        if (api.settings.nChannels > 2){
            lineA[2] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[2](d); });
        }
        if (api.settings.nChannels > 3){
            lineA[3] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[3](d); });
        }
        if (api.settings.nChannels > 4){
            lineA[4] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[4](d); });
        }
        if (api.settings.nChannels > 5){
            lineA[5] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[5](d); });
        }
        if (api.settings.nChannels > 6){
            lineA[6] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[6](d); });
        }
        if (api.settings.nChannels > 7){
            lineA[7] = d3.svg.line()
                .x(function(d,i) { return (startPos + i);})
                .y(function(d) { return yA[7](d); });
        }
    }

    api.init = function(element, nChannels){
        width = window.innerWidth - margin.left - margin.right,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
        plotElement = element;
        yA = [];
        lineA = [];
        svg = undefined;
        api.settings.nChannels = nChannels;

        d3.select('svg').remove();
        svg = d3.select(element).append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
          
        api.reset();
    }
    
    api.update = function(dataIn){
        //console.log(angular.toJson(dataIn));
        startPos = xPos > 0?xPos-1:0;
        xPos += dataIn[0].length;
        if (xPos >= width){
            xPos = xPos%width;
            startPos = 0;
            for (var ind in dataIn){
                dataIn[ind].splice(0,dataIn[ind].length-xPos); // over ran width, splice out data up to width  
            }
            tmpData = [];
            for (var i = 0; i < api.settings.nChannels;i++){
                tmpData[i] = undefined;
            }
            svg.selectAll('path.line').remove();
        }

        for (var i = 0; i < api.settings.nChannels; i++){
            if (tmpData[i]) {dataIn[i].splice(0,0,tmpData[i]);}
            svg.append('svg:path')
                .attr('class','line')
                .attr('stroke', colorList[i])
                .attr('d', lineA[i](dataIn[i]));
            tmpData[i] = dataIn[i].slice(-1)[0];
        }
    };
    
    api.resize = function(){
        width = window.innerWidth - margin.left - margin.right,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
        
        api.reset();
    };

    api.setN = setN;
    
    return api;
})
.factory('rmsTimePlot', function() {
    var colorList = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'];
    var margin, width, height, plotElement, dT;
    var headerPadding = 44;
    var footerPadding = 16;
    var leftPadding = 150;
    var rightPadding = 0;
    margin = {top: 10, right: 60, bottom: 60, left: 50};
    
    var svg, x, scaleX, y, autoY, xAxis, yAxis, zoom, line;
    var panExtent, xMax;
    var data = [], xPos = 0, startPos = 0;
    var tmpData = [];
    
    var GAIN = 1845;
    var yMax = 1000*2.5/GAIN; //mV // 130
    var factor = 1000*2.5/(GAIN*128);

    var api = {
      init:undefined,
      reset:undefined,
      resize:undefined,
      update:undefined,
      settings:{
        nChannels: 1,
        zoomOption: 0,
        autoscaleY: false
      }
    };
    
    function zoomed() {

      // limit pan within plot limits (avoid panning to -x values, etc.)
      var panL = [0, 0];
      panL = panLimit();
      zoom.translate(panL);

//         redraw existing lines at new scale
      svg.selectAll('path.line').remove();
      startPos = 0;
      xPos = data[0].length;
      for (var i = 0; i < api.settings.nChannels; i++){
          svg.append('svg:path')
              .datum(data[i])
              .attr('class', 'line')
              .attr('clip-path', 'url(#clip)')
              .attr('stroke', colorList[i%colorList.length])
              .attr('d', line);
              //.attr('d', line(dataIn[i]));
      }

      // tried this on-liner, doesn't work yet
//        svg.selectAll('path.line').call(line);

      // reset axes - had to add some code to handle the axis ticks being in seconds, not ms
      scaleX = d3.scale.linear()
          .domain([x.domain()[0]*dT, x.domain()[1]*dT])
          .range([0, width]);
  
      xAxis = d3.svg.axis()
          .scale(scaleX)
          .tickSize(-height)
          .tickPadding(10)	
          .tickSubdivide(true)	
          .orient('bottom');

      svg.select('.x.axis').call(xAxis);
      svg.select('.y.axis').call(yAxis);
    }
    
    function panLimit() {

      var divisor = {h: height / ((y.domain()[1]-y.domain()[0])*zoom.scale()), w: width / ((x.domain()[1]-x.domain()[0])*zoom.scale())},
        minX = -(((x.domain()[0]-x.domain()[1])*zoom.scale())+(panExtent.x[1]-(panExtent.x[1]-(width/divisor.w)))),
        minY = -(((y.domain()[0]-y.domain()[1])*zoom.scale())+(panExtent.y[1]-(panExtent.y[1]-(height*(zoom.scale())/divisor.h))))*divisor.h,
        maxX = -(((x.domain()[0]-x.domain()[1]))+(panExtent.x[1]-panExtent.x[0]))*divisor.w*zoom.scale(),
        maxY = (((y.domain()[0]-y.domain()[1])*zoom.scale())+(panExtent.y[1]-panExtent.y[0]))*divisor.h*zoom.scale(); 

      var zoomOption = api.settings.zoomOption;
      var tx = 0, ty = 0;
      if (zoomOption === 'X AND Y'|| zoomOption === 'X ONLY'){
          //console.log('zoom x');
          tx = x.domain()[0] < panExtent.x[0] ? 
                      minX : 
                      x.domain()[1] > panExtent.x[1] ? 
                              maxX : 
                              zoom.translate()[0];
      }
      if (!api.settings.autoscaleY && (zoomOption === 'X AND Y'|| zoomOption === 'Y ONLY') ){
          //console.log('zoom y');
          ty = y.domain()[0]  < panExtent.y[0]? 
                      minY : 
                      y.domain()[1] > panExtent.y[1] ? 
                              maxY : 
                              zoom.translate()[1];
      }
      //console.log('panX: '+tx+', panY: '+ty);
      return [tx,ty];

    }
    
    autoY = function(){
        var tmp = [], allData = [];
        // combine all channels
        for (var chInd in data){
            allData = allData.concat(data[chInd]);
        }
        // combine all 'y' values
        for (var dInd in allData){
            tmp.push(allData[dInd].y);
        }
        // find the max
        var maxArr = Math.max.apply(Math, tmp);
        var ret = maxArr > 1? maxArr:1;
        ret *= factor;
        return ret; 
    };
    
    api.reset = function(){
  
        if (svg){
            svg.selectAll('path.line').remove();
            d3.select('svg').remove();
        }
        
        xPos = 0;
        startPos = 0;
        data = [];
        tmpData = [];
        for (var i = 0; i < api.settings.nChannels;i++){
            data[i] = [];
            tmpData[i] = angular.undefined;
        }
        
        x = d3.scale.linear()
            .domain([0, xMax])
            .range([0, width]);
        
        scaleX = d3.scale.linear()
            .domain([x.domain()[0]*dT, x.domain()[1]*dT])
            .range([0, width]);
        
        y = d3.scale.linear().range([height, 0]);
        if (api.settings.autoscaleY){
            y.domain([0, autoY()]);
        }else {
            y.domain([-0.01*yMax, yMax*1.01]);
        }
    
        if (api.settings.zoomOption === 'NONE'){
          zoom = function(){};
        } else if (api.settings.zoomOption === 'X ONLY') {
          zoom = d3.behavior.zoom()
              .x(x)
              .scaleExtent([1, 10])
              .on('zoom', zoomed);
        } else if (api.settings.zoomOption === 'Y ONLY') {
          zoom = d3.behavior.zoom()
              .y(y)
              .scaleExtent([1, 10])
              .on('zoom', zoomed);
        } else if (api.settings.zoomOption === 'X AND Y') {
          zoom = d3.behavior.zoom()
              .x(x)
              .y(y)
              .scaleExtent([1, 10])
              .on('zoom', zoomed);
        }
    
        svg = d3.select(plotElement).append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')')
            .call(zoom);
      
        line = d3.svg.line()
            .interpolate('linear')	
            .x(function(d, i) { return x(startPos + i); })
            .y(function(d, i) { return y(factor*d); });	
    
        xAxis = d3.svg.axis()
            .scale(scaleX)
            .tickSize(-height)
            .tickPadding(10)	
            .tickSubdivide(true)	
            .orient('bottom');	

        yAxis = d3.svg.axis()
            .scale(y)
            .tickPadding(10)
            .tickSize(-width)
            .tickSubdivide(true)	
            .orient('left');
    
        svg.append('g')
            .attr('class', 'x axis')
//            .attr('fill','none')
            .attr('transform', 'translate(0,' + height + ')')
            .call(xAxis);

        svg.append('g')
            .attr('class', 'y axis')
//            .attr('fill','none')
            .call(yAxis);

        svg.append('g')
            .attr('class', 'y axis')
            .append('text')
            .attr('class', 'axis-label')
            .attr('transform', 'rotate(-90)')
            .attr('y', (-margin.left) + 15)
            .attr('x', -height/2-50)
            .text('RMS Muscle Signal, mV');	
    
        svg.append('g')
            .attr('class', 'x axis')
            .append('text')
            .attr('class', 'axis-label')
            .attr('y', height+35)
            .attr('x', width/2)
            .text('Time, s');	

        // keeps the zoom frame inside the plot window!
        svg.append('clipPath')
            .attr('id', 'clip')
            .append('rect')
            .attr('width', width)
            .attr('height', height);

    };

    api.init = function(element, nChannels, newZoomOption, maxX, userFrequency){
        width = window.innerWidth - margin.left - margin.right - leftPadding - rightPadding,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
    
        dT = 1/userFrequency;
        xMax = maxX/dT; // seconds
        panExtent = {x: [0,xMax], y: [-0.01*yMax,1.01*yMax] };
    
        xPos = 0;
        startPos = 0;
        plotElement = element;

        api.settings.zoomOption = newZoomOption;
        api.settings.nChannels = nChannels;
        
        api.reset();
    };
    
    api.update = function(dataIn){
        startPos = xPos > 0?xPos-1:0;
        xPos += dataIn[0].length;
        if (xPos >= xMax){
            xPos = xPos%xMax;
            startPos = 0;
            for (var ind in dataIn){
                dataIn[ind].splice(0,dataIn[ind].length-xPos); // over ran width, splice out data up to width  
            }
            svg.selectAll('path.line').remove();
            data = [];
            for (var i = 0; i < api.settings.nChannels;i++){
                data[i] = [];
                tmpData[i] = angular.undefined;
            }
        }
      
        if (api.settings.autoscaleY){
            y.domain([0, autoY()]);
        }

        for (var i = 0; i < api.settings.nChannels; i++){
            data[i] = data[i].concat(dataIn[i]);
            if (tmpData[i]) {dataIn[i].splice(0,0,tmpData[i]);}
            
            svg.append('svg:path')
                .datum(dataIn[i])
                .attr('class', 'line')
                .attr('clip-path', 'url(#clip)')
                .attr('stroke', colorList[i%colorList.length])
                .attr('d', line);

            tmpData[i] = dataIn[i].slice(-1)[0];
        }
    };
    
    api.resize = function(){
        console.log('DEBUG: plot resized');
        width = window.innerWidth - margin.left - margin.right - leftPadding - rightPadding,
        height = window.innerHeight - margin.top - headerPadding - margin.bottom - footerPadding;
          
        api.reset();
    };
    
    return api;
})
;

}());
