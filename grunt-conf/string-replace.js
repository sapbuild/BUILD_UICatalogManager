module.exports = {
    sonar: {
        files: {
            'reports/coverage/client/': ['reports/coverage/client/**.info'],
            'reports/coverage/server/': ['reports/coverage/server/**.info']
        },
        options: {
            replacements: [{
                pattern: /node_modules\/norman-ui-catalog-manager-client/gi,
                replacement: 'client'
            }, {
                pattern: /node_modules\/norman-ui-catalog-manager-server/gi,
                replacement: 'server'
            }]
        }
    },
    UICatalog: {
        files: {
            'client/styles/sprite.less': 'client/styles/sprite.less'
        },
        options: {
            replacements: [{
                pattern: 'background: url(../assets/',
                replacement: 'background: url(\'../resources/norman-ui-catalog-manager-client/assets/'
            }, {
                pattern: '.svg)',
                replacement: '.svg\')'
            }, {
                pattern: /svg-common/g,
                replacement: 'svg-uicatalog'
            }, {
                pattern: /-hover-dims/g,
                replacement: '-dims:hover'
            }, {
                pattern: /-hover/g,
                replacement: ':hover'
            }]
        }
    }
}
