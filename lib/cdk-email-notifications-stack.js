import { Stack, Duration } from 'aws-cdk-lib';
import { AuthorizationType, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import path, { join } from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);


class CdkEmailNotificationsStack extends Stack {

  constructor(scope, id, props) {
    super(scope, id, props);

    // create SQS
    const inquiryQueue = new Queue(this, 'inquiryProcessingQueue', {
      visibilityTimeout: Duration.seconds(45),
      queueName: "inquiry-processing-queue"
    });

    // create an sqs event source
    const sqsLambdaEventSource = new SqsEventSource(inquiryQueue, {
      batchSize: 10,
      enabled: true
    });

    const processInquiryFunction = new Function(this, 'ProcessInquiryLambda', {
      code: Code.fromAsset(join(path.dirname(__filename), '../lambdas')),
      runtime: Runtime.NODEJS_16_X,
      handler: 'handler.processInquiry'
    })

    // attach the event source to the orderProcessing lambda, so that Lambda can poll the queue and invoke the inquiry processing Lambda
    processInquiryFunction.addEventSource(sqsLambdaEventSource)

    // grant the inquiry process lambda permission to invoke ses
    processInquiryFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ses:*'],
      resources: ['*'],
      sid: 'SendEmailPolicy'
    }))

    // provision the dynamoDB
    const inquiryTable = new Table(this, 'OrderTable', {
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
        encryption: TableEncryption.DEFAULT,
        pointInTimeRecovery: false
      }
    })

    const createInquiryFunction = new Function(this, 'CreateInquiry', {
      code: Code.fromAsset(join(path.dirname(__filename), '../lambdas')),
      runtime: Runtime.NODEJS_16_X,
      handler: 'handler.createInquiry',
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        INQUIRY_TABLE_NAME: inquiryTable.tableName,
        INQUIRY_PROCESSING_QUEUE_URL: inquiryQueue.queueUrl,
        ADMIN_EMAIL: 'graffincindy@gmail.com'
      }
    })

    inquiryTable.grantWriteData(createInquiryFunction)
    inquiryQueue.grantSendMessages(createInquiryFunction)

    const restApi = new RestApi(this, 'EmailServiceApi', {
      restApiName: 'EmailService'
    })

    const newInquiries = restApi.root
      .addResource('inquiries')
      .addResource('new');

    newInquiries.addMethod('POST', new LambdaIntegration(createInquiryFunction), {
      authorizationType: AuthorizationType.NONE
    })
  }
}

export { CdkEmailNotificationsStack }
