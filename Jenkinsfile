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

        stage('Build') {
            steps {
                dir('backend') {
                    sh 'npm ci'
                    sh 'npm run build'
                }
                dir('frontend') {
                    sh 'npm ci'
                    sh 'npm run build:web'
                }
            }
        }

        stage('Test') {
            steps {
                dir('backend') {
                    sh 'npm run typecheck'
                    sh 'npm test'
                }
                dir('frontend') {
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
            echo "Build #${env.BUILD_NUMBER} succeeded on ${env.BRANCH_NAME ?: 'unknown branch'}."
        }
        failure {
            echo "Build #${env.BUILD_NUMBER} failed — see the stage logs above."
        }
        always {
            cleanWs()
        }
    }
}
