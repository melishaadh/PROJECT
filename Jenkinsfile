//hello TrekEasy CI. Deployment itself is handled by GitHub Actions (.github/workflows/cd.yml) —
// this pipeline only triggers it, via workflow_dispatch, once CI has passed.

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

        stage('Trigger GitHub Actions CD') {
            // Only reached if Checkout/Backend/Frontend/Archive all succeeded —
            // a declarative pipeline stops at the first failing stage, so CD
            // is never triggered after a failed CI run.
            steps {
                withCredentials([string(credentialsId: 'github-actions-token', variable: 'GITHUB_TOKEN')]) {
                    sh '''
                        set -e
                        SHA=$(git rev-parse HEAD)
                        echo "CI succeeded for commit ${SHA} - triggering GitHub Actions CD"

                        # Built with single quotes around the JSON template so no
                        # backslash-escaping of the inner double quotes is needed;
                        # only $SHA is substituted by the shell.
                        BODY='{"ref":"main","inputs":{"commit_sha":"'"$SHA"'"}}'

                        curl -fsSL -X POST \
                          -H "Accept: application/vnd.github+json" \
                          -H "Authorization: Bearer ${GITHUB_TOKEN}" \
                          -H "X-GitHub-Api-Version: 2022-11-28" \
                          https://api.github.com/repos/melishaadh/PROJECT/actions/workflows/cd.yml/dispatches \
                          -d "$BODY"
                    '''
                }
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
