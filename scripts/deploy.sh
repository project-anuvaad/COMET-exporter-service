export AWS_CLUSTER_NAME=$1
export AWS_SERVICE_NAME=$2
export AWS_REPO_NAME=$3
export TARGET_REPO=$AWS_ECR_ACCOUNT_URL/$AWS_REPO_NAME:${CI_COMMIT_REF_NAME}

if ["$1" = ""] || ["$2" = ""] || ["$3" = ""]; then
    echo "Usage: source deploy.sh cluster-name service-name ecs-repo-name"
    exit 1
else
    echo "Starting Deployment"
    echo "CLUSTER NAME = " + $AWS_CLUSTER_NAME
    echo "SERVICE NAME = " + $AWS_SERVICE_NAME
    # Install AWS CLI
    echo " INSTALLING AWS CLI "
    apk add --update python python-dev py-pip jq
    pip install awscli --upgrade
    pip install ecs-deploy

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

    # Pull image from gitlab registry
    # docker pull $CI_REGISTRY_IMAGE:$CI_COMMIT_REF_NAME

    # docker tag $CI_REGISTRY_IMAGE:$CI_COMMIT_REF_NAME $TARGET_REPO

    # # Push docker image to ECS REGISTRY
    # docker push $TARGET_REPO

    # Deploy service update
    ecs deploy ${AWS_CLUSTER_NAME} ${AWS_SERVICE_NAME} --timeout -1 --image ${AWS_SERVICE_NAME} $TARGET_REPO
fi
