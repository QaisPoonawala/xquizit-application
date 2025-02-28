import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export class QuizStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'QuizVPC', {
      maxAzs: 2,
      natGateways: 2
    });

    // Frontend - S3 bucket
    const websiteBucket = new s3.Bucket(this, 'QuizWebsiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // SSL Certificate
    const certificate = new acm.Certificate(this, 'QuizCertificate', {
      domainName: 'quiz.yourdomain.com',
      validation: acm.CertificateValidation.fromDns()
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'QuizDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
      },
      certificate: certificate,
      domainNames: ['quiz.yourdomain.com']
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'QuizCluster', {
      vpc,
      containerInsights: true
    });

    // Redis for Socket.IO scaling
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis cluster',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId)
    });

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for Redis cluster',
      allowAllOutbound: true
    });

    const redis = new elasticache.CfnCacheCluster(this, 'QuizRedis', {
      cacheNodeType: 'cache.t3.medium',
      engine: 'redis',
      numCacheNodes: 2,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      autoMinorVersionUpgrade: true
    });

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'QuizALB', {
      vpc,
      internetFacing: true
    });

    const listener = alb.addListener('Listener', {
      port: 443,
      certificates: [certificate],
      protocol: elbv2.ApplicationProtocol.HTTPS
    });

    // ECS Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'QuizTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024
    });

    const container = taskDefinition.addContainer('QuizContainer', {
      image: ecs.ContainerImage.fromAsset('.'),
      environment: {
        NODE_ENV: 'production',
        REDIS_URL: redis.attrRedisEndpointAddress,
        MONGODB_URI: 'your-mongodb-atlas-uri'
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'QuizApp' })
    });

    container.addPortMappings({
      containerPort: 5001
    });

    // ECS Service
    const service = new ecs.FargateService(this, 'QuizService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(60)
    });

    // Auto Scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

    // ALB Target Group
    listener.addTargets('QuizTarget', {
      port: 5001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5)
      },
      stickinessCookieDuration: cdk.Duration.hours(1)
    });

    // Route 53 DNS
    const zone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: 'yourdomain.com'
    });

    new route53.ARecord(this, 'QuizAliasRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      recordName: 'quiz.yourdomain.com'
    });

    // Output the CloudFront URL
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName
    });
  }
}
