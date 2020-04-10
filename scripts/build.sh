export AWS_CLUSTER_NAME=$1
export AWS_SERVICE_NAME=$2
export AWS_REPO_NAME=$3
export TARGET_REPO=$AWS_ECR_ACCOUNT_URL/$AWS_REPO_NAME:${CI_COMMIT_REF_NAME}

if ["$1" = ""] || ["$2" = ""] || ["$3" = ""]; then
        echo "Usage: source build.sh cluster-name service-name ecs-repo-name"
        exit 1
else

        echo "Building image..."
        docker build \
                --build-arg AWS_KEYS_FILE_BASE64=${AWS_KEYS_FILE_BASE64} \
                --build-arg AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} \
                --build-arg AWS_ACCESS_KEY_SECRET=${AWS_ACCESS_KEY_SECRET} \
                --build-arg DB_CONNECTION_URL=${DB_CONNECTION_URL} \
                --build-arg RABBITMQ_SERVER=${RABBITMQ_SERVER} \
                --build-arg GOOGLE_CLOUD_APP_BASE64=${GOOGLE_CLOUD_APP_BASE64} \
                --build-arg GOOGLE_CLOUD_PROJECT_ID=${GOOGLE_CLOUD_PROJECT_ID} \
                -f Dockerfile \
                -t $TARGET_REPO \
                .

        echo "CLUSTER NAME = " + $AWS_CLUSTER_NAME
        echo "SERVICE NAME = " + $AWS_SERVICE_NAME
        # Install AWS CLI
        echo " INSTALLING AWS CLI "
        apk add --update python python-dev py-pip jq
        pip install awscli --upgrade

        echo "CONFIGURING AWS"
        # Configure AWS Access Key ID
        aws configure set aws_access_key_id $AWS_ACCESS_KEY_ID --profile default

        # Configure AWS Secret Access Key
        aws configure set aws_secret_access_key $AWS_SECRET_ACCESS_KEY --profile default

        # Configure AWS default region
        aws configure set region $AWS_DEFAULT_REGION --profile default

        echo "LOGGING IN AWS ECR"
        # Log into Amazon ECR
        # aws ecr get-login returns a login command w/ a temp token
        LOGIN_COMMAND=$(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)

        # save it to an env var & use that env var to login
        $LOGIN_COMMAND
        docker push $TARGET_REPO

fi
