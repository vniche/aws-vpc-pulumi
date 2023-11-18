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

export type NATConfig = {
    subnetId: pulumi.Output<string>;
    az: string;
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }> | undefined
}

export type Subnet = SubnetConfig & {
    resource: aws.ec2.Subnet
};

export type Network = {
    vpcId: pulumi.Output<string>;
    subnets: Subnet[];
};