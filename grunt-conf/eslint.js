'use strict';
module.exports = {
    options: {
        config: '.eslintrc',
        ignore: false
    },
    client: {
        src: [
            'client/**/*.js',
            '!client/node_modules/**/*.js',
            '!client/test/**/*.js'
        ]
    },
    server: {
        src: [
            'server/**/*.js',
            '!server/node_modules/**/*.js',
            '!server/test/**/*.js'
        ]
    },
    e2e: {
        options: {
            config: '.eslintrc',
            ignore: false
        },
        src: [
            'test/e2e/**/*.js'
        ]
    },
    int: {
        options: {
            config: '.eslintrc',
            ignore: false
        },
        src: [
            'test/int/**/*.js'
        ]
    }
};
