import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export enum NATOptions {
    None = "none",
    InOneAZ = "inOneAZ",
    OnePerAZ = "onePerAZ"
};

export enum SubnetType {
    Public = "public",
    Private = "private"
};

export type SubnetConfig = {
    type: SubnetType;
    az: string;
    cidrBlock: string;
};

export type NetworkConfig = {
    cidrBlock: string;
    nat?: NATOptions | undefined;
    subnets: SubnetConfig[];
};

export type CreateNetworkArgs = NetworkConfig & {
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }> | undefined
};

type NATProps = {
    subnetId: pulumi.Output<string>;
    az: string;
};

export type CreateNATArgs = NATProps & {
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }> | undefined
};

export type CreateNATRouteTableArgs = NATProps & {
    vpcId: pulumi.Output<string>;
    natGatewayId: pulumi.Output<string>;
};

export type Subnet = SubnetConfig & {
    resource: aws.ec2.Subnet
};