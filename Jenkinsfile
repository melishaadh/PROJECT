// TrekEasy CI only. Deployment is handled by GitHub Actions.

pipeline {
    agent any

    tools {
        nodejs 'node20'
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
                archiveArtifacts artifacts: 'backend/dist/**, frontend/dist/**', fingerprint: true
            }
        }
    }

    post {
        success {
            echo 'Jenkins CI succeeded'
        }

        failure {
            echo 'Jenkins CI failed'
        }

        always {
            cleanWs()
        }
    }
}
