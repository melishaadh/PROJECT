// Webhook test
// TrekEasy CI pipeline — build, typecheck and test both apps, archive the
// build output, and report success/failure to Slack. This pipeline does
// NOT deploy anything: shipping to AWS is handled by
// .github/workflows/cd.yml (Docker Hub -> ECR -> ECS), not Jenkins.

// Plain String.replace() rather than groovy.json.JsonOutput: the latter is a
// static-method call that Jenkins' script-security sandbox usually blocks
// until an admin approves it under Manage Jenkins -> In-process Script
// Approval. Instance methods on String need no such approval.
def jsonEscape(String s) {
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
}

def notifySlack(String statusText) {
    def branch = sh(script: 'git rev-parse --abbrev-ref HEAD', returnStdout: true).trim()
    def commit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
    def author = sh(script: 'git log -1 --pretty=format:%an', returnStdout: true).trim()

    def text = "${statusText}\nRepo: melishaadh/trekeasy\nBranch: ${branch}\nCommit: ${commit}\nAuthor: ${author}\nBuild: ${env.BUILD_URL}"
    def payload = '{"text":"' + jsonEscape(text) + '"}'
    writeFile file: 'slack-payload.json', text: payload

    withCredentials([string(credentialsId: 'trekeasy-slack-webhook', variable: 'SLACK_WEBHOOK_URL')]) {
        sh 'curl -sf -X POST -H "Content-type: application/json" --data @slack-payload.json "$SLACK_WEBHOOK_URL"'
    }
    sh 'rm -f slack-payload.json'
}

pipeline {
    agent any

    tools {
        nodejs 'node20'
    }

    environment {
        APP_ENV = 'staging'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Backend') {
            steps {
                dir('backend') {
                    sh 'npm ci'
                    sh 'npm run build'
                    sh 'npm run typecheck'
                    sh 'npm test'
                }
            }
        }

        stage('Frontend') {
            steps {
                dir('frontend') {
                    sh 'npm ci'
                    sh 'npm run build:web'
                    sh 'npm run typecheck'
                }
            }
        }

        stage('Archive') {
            steps {
                archiveArtifacts artifacts: 'backend/dist/**, frontend/dist/**', fingerprint: true, allowEmptyArchive: false
            }
        }
    }

    post {
        success {
            script {
                notifySlack(":white_check_mark: Build #${env.BUILD_NUMBER} succeeded")
            }
        }
        failure {
            script {
                notifySlack(":x: Build #${env.BUILD_NUMBER} failed — see ${env.BUILD_URL}console")
            }
        }
        always {
            cleanWs()
        }
    }
}
